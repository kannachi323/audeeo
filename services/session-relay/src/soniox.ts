import { RealtimeSttSession, type RealtimeResult, type SttSessionConfig } from '@soniox/node';
import type { Language, Segment } from '../../../shared/pipeline';

const aliases: Record<string, string> = {cmn: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hk': 'zh', nb: 'no', nn: 'no', fil: 'tl'};
export function sonioxConfig(source: Language, target: Language, model = 'stt-rt-v5'): SttSessionConfig {
  return {
    model, audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
    enable_language_identification: true, enable_endpoint_detection: true,
    ...(source === 'auto' ? {} : {language_hints: [aliases[source] || source]}),
    ...(source === target ? {} : {translation: {type: 'one_way', target_language: aliases[target] || target}}),
  };
}

/** Final tokens are append-only; provisional tokens are a replacement snapshot.
 * Source and translation arrive independently, so never finalize on source punctuation.
 */
export class SonioxCaptions {
  private sequence = 0;
  private segment?: Segment;
  private sourceFinal = '';
  private translationFinal = '';
  private sourceDraft = '';
  private translationDraft = '';
  constructor(private sessionId: string, private source: Language, private target: Language, private emit: (s: Segment) => void) {}
  ingest(result: RealtimeResult, time: number) {
    this.sourceDraft = ''; this.translationDraft = '';
    for (const token of result.tokens) {
      if (!token.text || /^<(end|fin)>$/.test(token.text)) continue;
      this.segment ??= {
        id: `${this.sessionId}:soniox-${this.sequence}`, sessionId: this.sessionId,
        sequence: this.sequence++, revision: 0, startMs: token.start_ms ?? time, endMs: token.end_ms ?? time,
        sourceLanguage: this.source, targetLanguage: this.target, sourceText: '', translatedText: '',
        final: false, state: 'provisional',
      };
      this.segment.endMs = Math.max(this.segment.endMs, token.end_ms ?? time);
      if (token.translation_status === 'translation') {
        if (token.is_final) this.translationFinal += token.text; else this.translationDraft += token.text;
      } else {
        if (token.is_final) this.sourceFinal += token.text; else this.sourceDraft += token.text;
      }
    }
    this.publish(false);
    // Bound active caption/history records even during uninterrupted speech.
    if (this.sourceFinal.length + this.translationFinal.length >= 1000) this.flush();
  }
  private publish(final: boolean) {
    if (!this.segment) return;
    this.segment.sourceText = this.sourceFinal + (final ? '' : this.sourceDraft);
    this.segment.translatedText = this.translationFinal + (final ? '' : this.translationDraft);
    this.segment.final = final;
    this.segment.state = final ? 'complete' : 'provisional';
    this.segment.revision++;
    this.emit({...this.segment});
  }
  flush() {
    // Replace any visible draft with provider-confirmed text; never save a guess as final.
    if (this.sourceFinal || this.translationFinal) this.publish(true);
    else {
      this.sourceDraft = ''; this.translationDraft = '';
      this.publish(false);
    }
    this.segment = undefined;
    this.sourceFinal = ''; this.translationFinal = '';
    this.sourceDraft = ''; this.translationDraft = '';
  }
}

export class SonioxBackend {
  private session: RealtimeSttSession;
  readonly captions: SonioxCaptions;
  constructor(key: string, sessionId: string, source: Language, target: Language,
    emit: (s: Segment) => void, onError: (message: string) => void, onFinished: () => void,
    model?: string) {
    this.captions = new SonioxCaptions(sessionId, source, target, emit);
    this.session = new RealtimeSttSession(key, 'wss://stt-rt.soniox.com/transcribe-websocket',
      sonioxConfig(source, target, model), {connect_timeout_ms: 10000});
    this.session.on('result', result => this.captions.ingest(result, result.total_audio_proc_ms));
    this.session.on('endpoint', () => this.captions.flush());
    this.session.on('finished', onFinished);
    // Do not forward SDK exceptions, which can contain raw provider responses.
    this.session.on('error', () => onError('Soniox session failed. Check the server key, credits, model and language support.'));
  }
  async connect() {
    try { await this.session.connect(); }
    catch { throw new Error('Soniox could not connect. Check the server key and network.'); }
  }
  sendAudio(audio: ArrayBuffer | ArrayBufferView) {
    this.session.sendAudio(ArrayBuffer.isView(audio)
      ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) : new Uint8Array(audio));
  }
  finish() { return this.session.finish(); }
  close() { this.session.close(); }
}
