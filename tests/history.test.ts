import { it, expect, vi } from "vitest";
import { HistoryOutbox, type TextStorage } from "../shared/history";
import type { Segment } from "../shared/pipeline";
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  } satisfies TextStorage;
};
const segment: Segment = {
  id: "one",
  sessionId: "s",
  sequence: 0,
  revision: 1,
  startMs: 0,
  endMs: 1000,
  sourceLanguage: "zh",
  targetLanguage: "en",
  sourceText: "你好",
  translatedText: "Hello",
  final: true,
  state: "complete",
};
it("does not sync one identity’s text into a different signed-in account", async () => {
  const remote = { write: vi.fn(), delete: vi.fn() };
  const box = new HistoryOutbox("alice", memory(), remote, () => "bob");
  box.enqueue(segment);
  await box.flush();
  expect(remote.write).not.toHaveBeenCalled();
  expect(box.pending).toBe(1);
});
it("keeps offline writes and retries idempotently after reconnect", async () => {
  const storage = memory();
  const write = vi
    .fn()
    .mockRejectedValueOnce(Error())
    .mockResolvedValue(undefined);
  const remote = { write, delete: vi.fn() };
  const box = new HistoryOutbox("alice", storage, remote, () => "alice");
  box.enqueue(segment);
  await expect(box.flush()).rejects.toThrow();
  expect(box.pending).toBe(1);
  await new HistoryOutbox("alice", storage, remote, () => "alice").flush();
  expect(box.pending).toBe(0);
  expect(write).toHaveBeenCalledTimes(2);
});
it("does not remove a newer translation that arrives during a pending-source upload", async () => {
  let release!: () => void;
  const write = vi
    .fn()
    .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    .mockResolvedValue(undefined);
  const box = new HistoryOutbox(
    "a",
    memory(),
    { write, delete: vi.fn() },
    () => "a",
  );
  box.enqueue({ ...segment, translatedText: "", state: "pending" });
  const flush = box.flush();
  box.enqueue(segment);
  release();
  await flush;
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][1].translatedText).toBe("Hello");
  expect(box.pending).toBe(0);
});
it("queues deletions and removes unsynced content for the deleted session", async () => {
  const remote = { write: vi.fn(), delete: vi.fn() };
  const box = new HistoryOutbox("a", memory(), remote, () => "a");
  box.enqueue(segment);
  box.deleteSession("s");
  box.enqueue(segment);
  await box.flush();
  expect(remote.write).not.toHaveBeenCalled();
  expect(remote.delete).toHaveBeenCalledWith("a", "s");
});
it("never queues provisional text", () => {
  const box = new HistoryOutbox(
    "a",
    memory(),
    { write: vi.fn(), delete: vi.fn() },
    () => "a",
  );
  box.enqueue({ ...segment, final: false });
  expect(box.pending).toBe(0);
});
