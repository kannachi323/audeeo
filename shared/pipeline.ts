import type { Language } from "./languages";
export type { Language } from "./languages";
export type Segment = {
  id: string;
  sessionId: string;
  sequence: number;
  revision: number;
  startMs: number;
  endMs: number;
  sourceLanguage: Language;
  targetLanguage: Language;
  sourceText: string;
  translatedText: string;
  final: boolean;
  state: "provisional" | "pending" | "complete" | "translation-error";
  /** Server-issued recording metadata survives native/offline history recovery. */
  historyGeneration?: number;
  sessionStartedAt?: string;
};
export type TranslationMemory = { source: string; target: string };
export type Translate = (
  segment: Readonly<Segment>,
  context: TranslationMemory[],
) => Promise<string>;

/** Serial phrase translation preserves spoken/history order. ASR revisions are never sourced from the UI. */
export class CaptionPipeline {
  private segments = new Map<string, Segment>();
  private queue: string[] = [];
  private running?: Promise<void>;
  private accepting = true;
  private cancelled = false;
  private sequence = 0;
  private memory: TranslationMemory[] = [];
  constructor(
    private readonly translate: Translate,
    private readonly emit: (segment: Segment) => void,
    private readonly issue: (message: string) => void,
    private readonly capacity = 32,
  ) {}

  ingest(input: Omit<Segment, "sequence" | "state" | "translatedText">) {
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
    const next: Segment = {
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
