import type { Language, Segment as BaseSegment } from "./segment.js";

export type TranslationMemory = { source: string; target: string };
export type Translate<L extends string = Language> = (
  segment: Readonly<BaseSegment<L>>,
  context: TranslationMemory[],
) => Promise<string>;

/** Serial phrase translation preserves spoken/history order. ASR revisions are never sourced from the UI. */
export class CaptionPipeline<L extends string = Language> {
  private segments = new Map<string, BaseSegment<L>>();
  private queue: string[] = [];
  private running?: Promise<void>;
  private accepting = true;
  private cancelled = false;
  private sequence = 0;
  private memory: TranslationMemory[] = [];
  constructor(
    private readonly translate: Translate<L>,
    private readonly emit: (segment: BaseSegment<L>) => void,
    private readonly issue: (message: string) => void,
    private readonly capacity = 32,
  ) {}

  ingest(input: Omit<BaseSegment<L>, "sequence" | "state" | "translatedText">) {
    if (!this.accepting || !input.sourceText.trim()) return;
    const previous = this.segments.get(input.id);
    if (
      previous &&
      (input.revision <= previous.revision || (previous.final && !input.final))
    )
      return;
    // A committed segment is immutable; provider corrections must arrive before commit.
    if (
      previous?.state === "complete" ||
      previous?.state === "translation-error"
    )
      return;
    if (!previous && this.segments.size >= 256) {
      const old = [...this.segments.values()].find(
        (s) => s.state === "complete" || s.state === "translation-error",
      );
      if (old) this.segments.delete(old.id);
      else {
        this.issue("Caption buffer is full. Stop and reconnect.");
        return;
      }
    }
    const next: BaseSegment<L> = {
      ...input,
      sequence: previous?.sequence ?? this.sequence++,
      translatedText: "",
      state: input.final ? "pending" : "provisional",
    };
    this.segments.set(next.id, next);
    this.emit({ ...next });
    if (!input.final) return;
    if (!this.queue.includes(next.id)) {
      if (this.queue.length >= this.capacity) {
        next.state = "translation-error";
        this.emit({ ...next });
        this.issue(
          "Translation is behind. Original captions are preserved; start a new session to resume translation.",
        );
        return;
      }
      this.queue.push(next.id);
    }
    this.pump();
  }
  private pump() {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = undefined;
      if (this.queue.length) this.pump();
    });
  }
  private async drain() {
    while (this.queue.length) {
      const id = this.queue[0];
      const request = { ...this.segments.get(id)! };
      try {
        const text = await this.translate(request, [...this.memory]);
        if (this.cancelled) return;
        const current = this.segments.get(id)!;
        if (current.revision !== request.revision) continue; // Keep queue head; retry latest revision.
        if (!text.trim()) throw new Error("Empty translation");
        current.translatedText = text;
        current.state = "complete";
        this.memory.push({ source: current.sourceText, target: text });
        this.memory = this.memory.slice(-4);
        this.emit({ ...current });
      } catch {
        if (this.cancelled) return;
        const current = this.segments.get(id)!;
        if (current.revision !== request.revision) continue;
        current.state = "translation-error";
        this.emit({ ...current });
        this.issue(
          "Translation failed. Original captions remain available. Check your connection and retry with a new session.",
        );
      }
      this.queue.shift();
    }
  }
  async stop(timeoutMs = 12000) {
    this.accepting = false;
    // Unconfirmed ASR text remains provisional; never fabricate an ASR final on network loss.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      (async () => {
        while (this.running) await this.running;
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.cancelled = true;
          for (const id of this.queue) {
            const segment = this.segments.get(id)!;
            segment.state = "translation-error";
            this.emit({ ...segment });
          }
          this.queue = [];
          this.issue(
            "Some translations could not finish before shutdown. Original captions are preserved.",
          );
          resolve();
        }, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }
}
