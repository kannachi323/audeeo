import { it, expect, vi } from "vitest";
import { speechAllowed, SpeechQueue } from "../shared/speech";
import type { Segment } from "../shared/pipeline";
const route = {
  input: "microphone" as const,
  headphones: true,
  excludesOwnAudio: false,
  explicitlyEnabled: true,
};
const s: Segment = {
  id: "one",
  sessionId: "s",
  sequence: 0,
  revision: 1,
  startMs: 0,
  endMs: 1,
  sourceLanguage: "zh",
  targetLanguage: "en",
  sourceText: "你好",
  translatedText: "Hello",
  final: true,
  state: "complete",
};
it("prevents feedback and requires an explicit opt-in for device playback", () => {
  expect(speechAllowed({ ...route, headphones: false })).toBe(false);
  expect(speechAllowed({ ...route, input: "system" })).toBe(false);
  expect(
    speechAllowed({
      ...route,
      input: "system",
      excludesOwnAudio: true,
      explicitlyEnabled: false,
    }),
  ).toBe(false);
  expect(
    speechAllowed({ ...route, input: "system", excludesOwnAudio: true }),
  ).toBe(true);
});
it("speaks committed translations once, bounds the queue, and reports lag", async () => {
  const play = vi.fn(() => new Promise<void>(() => {})),
    report = vi.fn();
  const q = new SpeechQueue(play, report, 1);
  expect(q.enqueue({ ...s, final: false }, route)).toBe(false);
  expect(q.enqueue(s, route)).toBe(true);
  expect(q.enqueue(s, route)).toBe(true);
  expect(q.enqueue({ ...s, id: "two" }, route)).toBe(false);
  expect(play).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalled();
  expect(q.pending).toBe(1);
});
