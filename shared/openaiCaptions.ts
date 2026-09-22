import type { Language, Segment } from './pipeline';
import { formatChineseSegment, isChineseScriptConversion } from './chinese';

export function sessionConfig(source: Language, target: Language) {
  return source === target || isChineseScriptConversion(source,target)
    ? { type: 'session.update', session: { type: 'transcription', audio: { input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: 'gpt-live-transcribe', ...(source === 'auto' ? {} : {languages: [source]}), delay: 'low' },
        // Live API rejects server_vad and semantic_vad for this model (2026-09-13).
        // Deltas stream before the sole end-of-capture commit.
        turn_detection: null,
      } } } }
    : { type: 'session.update', session: { audio: { output: { language: target === 'zh-cn' ? 'zh' : target } } } };
}

/** Stateful 16 kHz PCM16 to 24 kHz conversion across capture packet boundaries. */
export class AudioEncoder {
  private samples: number[] = [];
  private position = 0;
  encode(buffer: ArrayBuffer | ArrayBufferView) {
    const view = ArrayBuffer.isView(buffer)
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);
    for (let i = 0; i < buffer.byteLength; i += 2) this.samples.push(view.getInt16(i, true));
    const output: number[] = [];
    while (this.position + 1 < this.samples.length) {
      const i = Math.floor(this.position), f = this.position - i;
      const value = Math.round(this.samples[i] * (1 - f) + this.samples[i + 1] * f);
      output.push(value & 255, (value >> 8) & 255);
      this.position += 2 / 3;
    }
    const consumed = Math.floor(this.position);
    this.samples = this.samples.slice(consumed);
    this.position -= consumed;
    return btoa(String.fromCharCode(...output));
  }
}

export class OpenAICaptions {
  private items = new Map<string, Segment>();
  private sequence = 0;
  private translation?: Segment;
  constructor(private sessionId: string, private source: Language, private target: Language, private emit: (s: Segment) => void) {}
  private create(id: string, time: number): Segment {
    return { id: `${this.sessionId}:${id}`, sessionId: this.sessionId, sequence: this.sequence++, revision: 0,
      startMs: time, endMs: time, sourceLanguage: this.source, targetLanguage: this.target,
      sourceText: '', translatedText: '', final: false, state: 'provisional' };
  }
  ingest(e: any, time: number) {
    if (this.source !== this.target && !isChineseScriptConversion(this.source,this.target)) {
      if (e.type !== 'session.output_transcript.delta' || typeof e.delta !== 'string') return;
      this.translation ??= this.create(`translation-${this.sequence}`, time);
      this.translation.translatedText += e.delta;
      this.translation.endMs = time;
      this.translation.revision++;
      this.emit(formatChineseSegment(this.translation));
      if (this.translation.translatedText.length >= 300 || /[.!?。！？\n]\s*$/.test(this.translation.translatedText)) this.flush();
      return;
    }
    if (!['conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed'].includes(e.type) || typeof e.item_id !== 'string') return;
    let s = this.items.get(e.item_id);
    if (!s) { s = this.create(e.item_id, time); this.items.set(e.item_id, s); }
    if (s.final) return;
    if (e.type.endsWith('.completed')) { s.sourceText = e.transcript || ''; s.final = true; s.state = 'complete'; }
    else s.sourceText += e.delta || '';
    s.endMs = time; s.revision++;
    this.emit(formatChineseSegment(s));
    if (this.items.size > 256) { for (const [id, item] of this.items) if (item.final) { this.items.delete(id); break; } }
  }
  flush() {
    for (const item of this.items.values()) {
      if (!item.final && item.sourceText) {
        item.final = true; item.state = 'complete'; item.revision++;
        this.emit(formatChineseSegment(item));
      }
    }
    if (!this.translation) return;
    this.translation.final = true; this.translation.state = 'complete'; this.translation.revision++;
    this.emit(formatChineseSegment(this.translation)); this.translation = undefined;
  }
}
