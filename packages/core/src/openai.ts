import { identityFormat, type Channel, type Language, type Segment, type SegmentFormat } from "./segment.js";

export type OpenAICaptionOptions<L extends string = Language> = {
  /** Defaults to source !== target. */
  translating?: boolean;
  channel?: Channel;
  format?: SegmentFormat<L>;
};

export function sessionConfig(source: Language, target: Language, translating = source !== target) {
  return !translating
    ? {
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-live-transcribe", ...(source === "auto" ? {} : { languages: [source] }), delay: "low" },
              // Live API rejects server_vad and semantic_vad for this model (2026-09-13).
              // Deltas stream before the sole end-of-capture commit.
              turn_detection: null,
            },
          },
        },
      }
    : { type: "session.update", session: { audio: { output: { language: target === "zh-cn" ? "zh" : target } } } };
}

/** Stateful 16 kHz PCM16 to 24 kHz conversion across capture packet boundaries. */
export class AudioEncoder {
  private samples: number[] = [];
  private position = 0;
  encode(buffer: ArrayBuffer | ArrayBufferView) {
    const view = ArrayBuffer.isView(buffer)
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);
    for (let i = 0; i + 1 < view.byteLength; i += 2) this.samples.push(view.getInt16(i, true));
    const output: number[] = [];
    while (this.position + 1 < this.samples.length) {
      const i = Math.floor(this.position);
      const f = this.position - i;
      const value = Math.round(this.samples[i] * (1 - f) + this.samples[i + 1] * f);
      output.push(value & 255, (value >> 8) & 255);
      this.position += 2 / 3;
    }
    const consumed = Math.floor(this.position);
    this.samples = this.samples.slice(consumed);
    this.position -= consumed;
    let binary = "";
    for (const byte of output) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

type OpenAIEvent = { type?: string; delta?: unknown; item_id?: unknown; transcript?: string };

/** OpenAI realtime transcription and translation events as revised segments. */
export class OpenAICaptions<L extends string = Language> {
  private items = new Map<string, Segment<L>>();
  private sequence = 0;
  private translation?: Segment<L>;
  private readonly translating: boolean;
  private readonly format: SegmentFormat<L>;

  constructor(
    private sessionId: string,
    private source: L,
    private target: L,
    private emit: (segment: Segment<L>) => void,
    private options: OpenAICaptionOptions<L> = {},
  ) {
    this.translating = options.translating ?? source !== target;
    this.format = options.format ?? identityFormat;
  }

  private create(id: string, time: number): Segment<L> {
    return {
      id: `${this.sessionId}:${id}`, sessionId: this.sessionId, sequence: this.sequence++, revision: 0,
      startMs: time, endMs: time, sourceLanguage: this.source, targetLanguage: this.target,
      sourceText: "", translatedText: "", final: false, state: "provisional",
      ...(this.options.channel ? { channel: this.options.channel } : {}),
    };
  }

  private send(segment: Segment<L>) {
    this.emit(this.format({ ...segment }));
  }

  ingest(event: OpenAIEvent, time: number) {
    if (this.translating) {
      if (event.type !== "session.output_transcript.delta" || typeof event.delta !== "string") return;
      this.translation ??= this.create(`translation-${this.sequence}`, time);
      this.translation.translatedText += event.delta;
      this.translation.endMs = time;
      this.translation.revision++;
      this.send(this.translation);
      if (this.translation.translatedText.length >= 300 || /[.!?。！？\n]\s*$/.test(this.translation.translatedText)) this.flush();
      return;
    }
    const kinds = ["conversation.item.input_audio_transcription.delta", "conversation.item.input_audio_transcription.completed"];
    if (!kinds.includes(event.type ?? "") || typeof event.item_id !== "string") return;
    let segment = this.items.get(event.item_id);
    if (!segment) {
      segment = this.create(event.item_id, time);
      this.items.set(event.item_id, segment);
    }
    if (segment.final) return;
    if (event.type!.endsWith(".completed")) {
      segment.sourceText = event.transcript || "";
      segment.final = true;
      segment.state = "complete";
    } else segment.sourceText += typeof event.delta === "string" ? event.delta : "";
    segment.endMs = time;
    segment.revision++;
    this.send(segment);
    if (this.items.size > 256) {
      for (const [id, item] of this.items) if (item.final) { this.items.delete(id); break; }
    }
  }

  flush() {
    for (const item of this.items.values()) {
      if (!item.final && item.sourceText) {
        item.final = true; item.state = "complete"; item.revision++;
        this.send(item);
      }
    }
    if (!this.translation) return;
    this.translation.final = true; this.translation.state = "complete"; this.translation.revision++;
    this.send(this.translation);
    this.translation = undefined;
  }
}
