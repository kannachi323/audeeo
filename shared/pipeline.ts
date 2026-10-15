import type { Language } from "./languages";
import {
  CaptionPipeline as CoreCaptionPipeline,
  type Segment as CoreSegment,
  type Translate as CoreTranslate,
} from "../packages/core/src";
export type { Language } from "./languages";
export type { TranslationMemory } from "../packages/core/src";
export type Segment = CoreSegment<Language>;
export type Translate = CoreTranslate<Language>;

/** Serial phrase translation preserves spoken/history order. ASR revisions are never sourced from the UI. */
export class CaptionPipeline extends CoreCaptionPipeline<Language> {}

export class DeepgramSegments {
  private revisions = new Map<string, number>();
  constructor(
    private sessionId: string,
    private source: Language,
    private target: Language,
  ) {}
  parse(
    raw: unknown,
  ): Omit<Segment, "sequence" | "state" | "translatedText"> | undefined {
    const e = raw as {
      type?: string;
      start?: number;
      duration?: number;
      is_final?: boolean;
      channel?: { alternatives?: { transcript?: string }[] };
    };
    if (
      e.type !== "Results" ||
      !Number.isFinite(e.start) ||
      !Number.isFinite(e.duration)
    )
      return;
    const text = e.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;
    const id = `${this.sessionId}:${Math.round(e.start! * 1000)}`;
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    if (this.revisions.size > 256)
      this.revisions.delete(this.revisions.keys().next().value!);
    return {
      id,
      sessionId: this.sessionId,
      revision,
      startMs: Math.round(e.start! * 1000),
      endMs: Math.round((e.start! + e.duration!) * 1000),
      sourceLanguage: this.source,
      targetLanguage: this.target,
      sourceText: text,
      final: !!e.is_final,
    };
  }
}
