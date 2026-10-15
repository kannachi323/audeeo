import { speakerKey, type Segment } from "./segment.js";

export type Turn = {
  speaker: string;
  channel?: Segment["channel"];
  startMs: number;
  endMs: number;
  text: string;
  final: boolean;
  segmentIds: string[];
};

/**
 * Keeps the latest revision of every segment from one or more streams.
 * Stale or out-of-order revisions are dropped, and a final segment is never
 * replaced, so a transcript only moves forward.
 */
export class Transcript {
  private byId = new Map<string, Segment>();

  /** Returns true when the segment changed the transcript. */
  accept(segment: Segment): boolean {
    const previous = this.byId.get(segment.id);
    if (previous && (previous.final || segment.revision <= previous.revision)) return false;
    if (!segment.sourceText.trim() && !previous) return false;
    this.byId.set(segment.id, { ...segment });
    return true;
  }

  segments(): Segment[] {
    return [...this.byId.values()]
      .filter((segment) => segment.sourceText.trim())
      .sort((a, b) => a.startMs - b.startMs || a.sequence - b.sequence);
  }

  /** Consecutive segments from the same speaker on the same channel. */
  turns(): Turn[] {
    const turns: Turn[] = [];
    for (const segment of this.segments()) {
      const speaker = speakerKey(segment);
      const last = turns.at(-1);
      if (last && last.speaker === speaker) {
        last.text = `${last.text} ${segment.sourceText.trim()}`;
        last.endMs = Math.max(last.endMs, segment.endMs);
        last.final &&= segment.final;
        last.segmentIds.push(segment.id);
        continue;
      }
      turns.push({
        speaker,
        channel: segment.channel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.sourceText.trim(),
        final: segment.final,
        segmentIds: [segment.id],
      });
    }
    return turns;
  }

  /** Plain text with speaker labels, for notes, export and search. */
  text(name: (speaker: string) => string = (speaker) => speaker): string {
    return this.turns()
      .map((turn) => `${name(turn.speaker)}: ${turn.text}`)
      .join("\n");
  }

  clear() {
    this.byId.clear();
  }
}
