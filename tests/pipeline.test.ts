import { describe, it, expect, vi } from "vitest";
import {
  CaptionPipeline,
  DeepgramSegments,
  type Segment,
} from "../shared/pipeline";
import { translationBody } from "../shared/translation";
const input = (id = "one", revision = 1, final = true) => ({
  id,
  sessionId: "session",
  revision,
  startMs: 0,
  endMs: 1000,
  sourceLanguage: "zh" as const,
  targetLanguage: "en" as const,
  sourceText: `你好 ${revision}`,
  final,
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
describe("caption stream", () => {
  it("publishes provisional captions without spending a translation request", async () => {
    const translate = vi.fn();
    const events: Segment[] = [];
    const p = new CaptionPipeline(translate, (s) => events.push(s), vi.fn());
    p.ingest(input("one", 1, false));
    expect(events[0].state).toBe("provisional");
    expect(translate).not.toHaveBeenCalled();
    await p.stop();
  });
  it("rejects stale responses and preserves phrase order during revisions", async () => {
    const first = deferred<string>();
    const calls: string[] = [];
    const events: Segment[] = [];
    const p = new CaptionPipeline(
      async (s) => {
        calls.push(`${s.id}:${s.revision}`);
        return calls.length === 1 ? first.promise : s.sourceText;
      },
      (s) => events.push(s),
      vi.fn(),
    );
    p.ingest(input());
    p.ingest(input("two"));
    p.ingest(input("one", 2));
    first.resolve("STALE");
    await p.stop();
    expect(calls).toEqual(["one:1", "one:2", "two:1"]);
    expect(events.some((s) => s.translatedText === "STALE")).toBe(false);
    expect(
      events.filter((s) => s.state === "complete").map((s) => s.id),
    ).toEqual(["one", "two"]);
  });
  it("retains the source when translation fails and drains the next phrase", async () => {
    const events: Segment[] = [];
    const issue = vi.fn();
    const p = new CaptionPipeline(
      async (s) => {
        if (s.id === "one") throw Error();
        return "hello";
      },
      (s) => events.push(s),
      issue,
    );
    p.ingest(input());
    p.ingest(input("two"));
    await p.stop();
    expect(
      events.find((s) => s.state === "translation-error")?.sourceText,
    ).toBe("你好 1");
    expect(events.at(-1)?.state).toBe("complete");
    expect(issue).toHaveBeenCalled();
  });
  it("bounds pending work visibly without silently discarding original text", async () => {
    const d = deferred<string>();
    const events: Segment[] = [];
    const issue = vi.fn();
    const p = new CaptionPipeline(
      () => d.promise,
      (s) => events.push(s),
      issue,
      1,
    );
    p.ingest(input());
    p.ingest(input("two"));
    expect(events.at(-1)?.state).toBe("translation-error");
    expect(events.at(-1)?.sourceText).toBe("你好 1");
    d.resolve("hello");
    await p.stop();
  });
  it("flushes pending work on stop and rejects subsequent audio results", async () => {
    const d = deferred<string>();
    const events: Segment[] = [];
    const p = new CaptionPipeline(
      () => d.promise,
      (s) => events.push(s),
      vi.fn(),
    );
    p.ingest(input());
    let done = false;
    const stopping = p.stop().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    p.ingest(input("late"));
    d.resolve("hello");
    await stopping;
    expect(events.at(-1)?.translatedText).toBe("hello");
    expect(events.some((s) => s.id === "late")).toBe(false);
  });
  it("deduplicates repeated revisions and immutable committed phrases", async () => {
    const fn = vi.fn(async () => "hello");
    const p = new CaptionPipeline(fn, vi.fn(), vi.fn());
    p.ingest(input());
    p.ingest(input());
    await p.stop();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("uses provider time ranges and never commits a remembered draft for an empty final", () => {
    const parser = new DeepgramSegments("a", "zh", "en");
    const event = {
      type: "Results",
      start: 1,
      duration: 0.8,
      is_final: false,
      channel: { alternatives: [{ transcript: "你好" }] },
    };
    expect(parser.parse(event)?.startMs).toBe(1000);
    expect(parser.parse({ ...event, is_final: true })?.revision).toBe(2);
    expect(
      parser.parse({
        ...event,
        is_final: true,
        channel: { alternatives: [{ transcript: "" }] },
      }),
    ).toBeUndefined();
    expect(new DeepgramSegments("b", "zh", "en").parse(event)?.id).not.toBe(
      parser.parse(event)?.id,
    );
  });
  it("uses documented translation controls with exactly one user message", () => {
    const body = translationBody(
      input(),
      [{ source: "张伟", target: "Zhang Wei" }],
      [{ source: "Audeeo", target: "Audeeo" }],
      "Travel",
    );
    expect(body.model).toBe("qwen-mt-flash");
    expect(body.messages).toHaveLength(1);
    expect(body.translation_options.source_lang).toBe("Chinese");
    expect(body.translation_options.tm_list).toHaveLength(1);
    expect(body.translation_options.terms).toHaveLength(1);
  });
});

it("bounds shutdown and rejects a translation that arrives after the drain deadline", async () => {
  vi.useFakeTimers();
  const d = deferred<string>();
  const events: Segment[] = [];
  const p = new CaptionPipeline(
    () => d.promise,
    (s) => events.push(s),
    vi.fn(),
  );
  p.ingest(input());
  const done = p.stop(100);
  await vi.advanceTimersByTimeAsync(100);
  await done;
  expect(events.at(-1)?.state).toBe("translation-error");
  d.resolve("late");
  await Promise.resolve();
  expect(events.some((s) => s.translatedText === "late")).toBe(false);
  vi.useRealTimers();
});
