/** BCP-47-ish language code, or "auto" for detection. */
export type Language = string;

/** Which capture stream a segment came from. The mic is the local person. */
export type Channel = "mic" | "system";

export type Word = {
  text: string;
  /** Milliseconds from the start of the stream. */
  t0: number;
  t1: number;
  speaker?: string;
};

export type SegmentState = "provisional" | "pending" | "complete" | "translation-error";

/**
 * One phrase of a live transcript. A segment is revised in place (same `id`,
 * higher `revision`) until it is final; a final segment never changes again.
 */
export type Segment<L extends string = Language> = {
  id: string;
  sessionId: string;
  sequence: number;
  revision: number;
  startMs: number;
  endMs: number;
  sourceLanguage: L;
  targetLanguage: L;
  sourceText: string;
  translatedText: string;
  final: boolean;
  state: SegmentState;
  /** Provider speaker label within this channel ("1", "2", …). */
  speaker?: string;
  channel?: Channel;
  /** Final words with timings; absent while provisional. */
  words?: Word[];
  /** Server-issued recording metadata survives native/offline history recovery. */
  historyGeneration?: number;
  sessionStartedAt?: string;
};

/** Optional per-segment presentation hook (for example script conversion). */
export type SegmentFormat<L extends string = Language> = (segment: Segment<L>) => Segment<L>;
export const identityFormat = <L extends string>(segment: Segment<L>) => segment;

/** A stable label for a speaker: the mic is always the local person. */
export function speakerKey(segment: { channel?: Channel; speaker?: string }) {
  if (segment.channel === "mic") return segment.speaker ? `you:${segment.speaker}` : "you";
  return `${segment.channel ?? "audio"}:${segment.speaker ?? "?"}`;
}
