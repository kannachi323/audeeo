import type { Segment } from "./pipeline";
export type AudioRoute = {
  input: "microphone" | "system";
  headphones: boolean;
  excludesOwnAudio: boolean;
  explicitlyEnabled: boolean;
};
export function speechAllowed(route: AudioRoute) {
  if (!route.explicitlyEnabled) return false;
  return route.input === "microphone"
    ? route.headphones
    : route.excludesOwnAudio;
}
/** Backpressure is visible and pauses speech acceptance; no silent oldest-item dropping. */
export class SpeechQueue {
  private queue: Segment[] = [];
  private seen = new Set<string>();
  private playing = false;
  private generation = 0;
  constructor(
    private play: (segment: Segment) => Promise<void>,
    private report: (message: string) => void,
    private capacity = 8,
  ) {}
  enqueue(segment: Segment, route: AudioRoute): boolean {
    if (!speechAllowed(route) || !segment.final || segment.state !== "complete")
      return false;
    if (this.seen.has(segment.id)) return true;
    if (this.queue.length >= this.capacity) {
      this.report(
        "Speech is behind. Pause capture to let playback catch up. This caption has not been queued for speech.",
      );
      return false;
    }
    this.seen.add(segment.id);
    this.queue.push(segment);
    void this.drain();
    return true;
  }
  private async drain() {
    if (this.playing) return;
    this.playing = true;
    const generation = this.generation;
    try {
      while (this.queue.length && generation === this.generation) {
        try {
          await this.play(this.queue[0]);
        } catch {
          this.report("Speech playback failed. The caption remains available.");
          break;
        }
        if (generation === this.generation) this.queue.shift();
      }
    } finally {
      this.playing = false;
    }
  }
  clear() {
    this.generation++;
    this.queue = [];
    this.seen.clear();
  }
  get pending() {
    return this.queue.length;
  }
}
