import { identityFormat, type Channel, type Language, type Segment, type SegmentFormat, type Word } from "./segment";

export type SonioxToken = {
  text: string;
  is_final: boolean;
  translation_status?: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: string | number;
  language?: string;
};
export type SonioxResult = { tokens: SonioxToken[] };

/** Soniox's own context shape: general key/values, free text and terms. */
export type SonioxContext = {
  general?: { key: string; value: string }[];
  text?: string;
  terms?: string[];
  translation_terms?: { source: string; target: string }[];
};

export type SonioxConfigOptions = {
  model?: string;
  context?: SonioxContext;
  diarization?: boolean;
};

const aliases: Record<string, string> = { cmn: "zh", "zh-cn": "zh", "zh-tw": "zh", "zh-hk": "zh", nb: "no", nn: "no", fil: "tl" };
export const sonioxLanguage = (language: Language) => aliases[language] || language;

function hasContext(context?: SonioxContext) {
  return !!context && !!(context.general?.length || context.text || context.terms?.length || context.translation_terms?.length);
}

/** Realtime session config for 16 kHz mono PCM16. Translation only when the languages differ. */
export function sonioxConfig(source: Language, target: Language, options: SonioxConfigOptions = {}) {
  return {
    model: options.model ?? "stt-rt-v5",
    audio_format: "pcm_s16le" as const,
    sample_rate: 16000,
    num_channels: 1,
    enable_language_identification: true,
    enable_endpoint_detection: true,
    ...(options.diarization ? { enable_speaker_diarization: true } : {}),
    ...(source === "auto" ? {} : { language_hints: [sonioxLanguage(source)] }),
    ...(source === target || target === "auto"
      ? {}
      : { translation: { type: "one_way" as const, target_language: sonioxLanguage(target) } }),
    ...(hasContext(options.context) ? { context: options.context } : {}),
  };
}

export type SonioxCaptionOptions<L extends string = Language> = {
  channel?: Channel;
  format?: SegmentFormat<L>;
  /** Skip translation output, for transcribe-only sessions. */
  noTranslation?: boolean;
};

/**
 * Turns Soniox token streams into revised segments. Final tokens are
 * append-only; provisional tokens are a replacement snapshot. A final token
 * from a new speaker closes the current segment, so each segment has one
 * speaker. Source and translation arrive independently, so a segment never
 * finalizes on source punctuation alone.
 */
export class SonioxCaptions<L extends string = Language> {
  private sequence = 0;
  private segment?: Segment<L>;
  private sourceFinal = "";
  private translationFinal = "";
  private sourceDraft = "";
  private translationDraft = "";
  private words: Word[] = [];
  private readonly format: SegmentFormat<L>;

  constructor(
    private sessionId: string,
    private source: L,
    private target: L,
    private emit: (segment: Segment<L>) => void,
    private options: SonioxCaptionOptions<L> = {},
  ) {
    this.format = options.format ?? identityFormat;
  }

  ingest(result: SonioxResult, time: number) {
    this.sourceDraft = "";
    this.translationDraft = "";
    for (const token of result.tokens) {
      if (!token.text || /^<(end|fin)>$/.test(token.text)) continue;
      const translation = token.translation_status === "translation";
      if (translation && this.options.noTranslation) continue;
      const speaker = token.speaker === undefined ? undefined : String(token.speaker);
      if (!translation && token.is_final && speaker && this.segment?.speaker && speaker !== this.segment.speaker && this.sourceFinal) {
        // Carry the provisional tail of this result into the next speaker's segment.
        this.sourceDraft = "";
        this.flush();
      }
      this.open(token, time, speaker);
      const segment = this.segment!;
      segment.endMs = Math.max(segment.endMs, token.end_ms ?? time);
      if (translation) {
        if (token.is_final) this.translationFinal += token.text;
        else this.translationDraft += token.text;
        continue;
      }
      if (speaker && !segment.speaker) segment.speaker = speaker;
      if (token.is_final) {
        this.sourceFinal += token.text;
        this.addWord(token, speaker ?? segment.speaker);
      } else this.sourceDraft += token.text;
    }
    this.publish(false);
    // Bound active caption/history records even during uninterrupted speech.
    if (this.sourceFinal.length + this.translationFinal.length >= 1000) this.flush();
  }

  private open(token: SonioxToken, time: number, speaker?: string) {
    this.segment ??= {
      id: `${this.sessionId}:soniox-${this.sequence}`,
      sessionId: this.sessionId,
      sequence: this.sequence++,
      revision: 0,
      startMs: token.start_ms ?? time,
      endMs: token.end_ms ?? time,
      sourceLanguage: this.source,
      targetLanguage: this.target,
      sourceText: "",
      translatedText: "",
      final: false,
      state: "provisional",
      ...(speaker ? { speaker } : {}),
      ...(this.options.channel ? { channel: this.options.channel } : {}),
    };
  }

  private addWord(token: SonioxToken, speaker?: string) {
    const t0 = token.start_ms ?? this.segment!.endMs;
    const t1 = token.end_ms ?? t0;
    const last = this.words.at(-1);
    // Soniox tokens are sub-word pieces; a leading space starts a new word.
    if (last && !/^\s/.test(token.text)) {
      last.text += token.text;
      last.t1 = Math.max(last.t1, t1);
      return;
    }
    const text = token.text.trim();
    if (text) this.words.push({ text, t0, t1, ...(speaker ? { speaker } : {}) });
  }

  private publish(final: boolean) {
    if (!this.segment) return;
    this.segment.sourceText = this.sourceFinal + (final ? "" : this.sourceDraft);
    this.segment.translatedText = this.translationFinal + (final ? "" : this.translationDraft);
    this.segment.final = final;
    this.segment.state = final ? "complete" : "provisional";
    if (final && this.words.length) this.segment.words = this.words.map((word) => ({ ...word }));
    this.segment.revision++;
    this.emit(this.format({ ...this.segment }));
  }

  flush() {
    // Replace any visible draft with provider-confirmed text; never save a guess as final.
    if (this.sourceFinal || this.translationFinal) this.publish(true);
    else {
      this.sourceDraft = "";
      this.translationDraft = "";
      this.publish(false);
    }
    this.segment = undefined;
    this.sourceFinal = "";
    this.translationFinal = "";
    this.sourceDraft = "";
    this.translationDraft = "";
    this.words = [];
  }
}
