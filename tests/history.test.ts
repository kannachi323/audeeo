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
  box.completeSessions();
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
  box.completeSessions();
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
  box.completeSessions();
  const flush = box.flush();
  box.enqueue(segment);
  release();
  await flush;
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][1][0].translatedText).toBe("Hello");
  expect(box.pending).toBe(0);
});
it("queues deletions and removes unsynced content for the deleted session", async () => {
  const remote = { write: vi.fn(), delete: vi.fn() };
  const box = new HistoryOutbox("a", memory(), remote, () => "a");
  box.enqueue(segment);
  box.deleteSession("s");
  box.enqueue(segment);
  box.completeSessions();
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

it("keeps active captions local even when history or reconnect triggers a flush", async () => {
  const remote = { write: vi.fn(), delete: vi.fn() };
  const box = new HistoryOutbox("a", memory(), remote, () => "a");
  for (let i=0;i<250;i++) box.enqueue({...segment,id:`caption-${i}`,sequence:i});
  await box.flush();
  expect(remote.write).not.toHaveBeenCalled();
  expect(box.pending).toBe(250);
  box.completeSessions();
  await box.flush();
  expect(remote.write).toHaveBeenCalledTimes(1);
  expect(remote.write.mock.calls[0][1]).toHaveLength(250);
  expect(box.pending).toBe(0);
});
it("sends one completed document per session and retains its original start time", async () => {
  const remote = { write: vi.fn(), delete: vi.fn() };
  const box = new HistoryOutbox("a", memory(), remote, () => "a");
  box.enqueue(segment, "2026-09-15T12:00:00Z");
  box.enqueue({...segment,id:"two",sequence:1});
  box.completeSessions();
  box.enqueue({...segment,id:"active",sessionId:"ongoing"});
  await box.flush();
  expect(remote.write).toHaveBeenCalledTimes(1);
  expect(remote.write.mock.calls[0][1]).toHaveLength(2);
  expect(remote.write.mock.calls[0][2]).toBe("2026-09-15T12:00:00Z");
  expect(box.pending).toBe(1);
});
it("preserves deletion queued while a completed document is uploading", async () => {
  let release!: () => void;
  const remote = {write:vi.fn(() => new Promise<void>(resolve => {release=resolve;})),delete:vi.fn()};
  const box = new HistoryOutbox("a", memory(), remote, () => "a");
  box.enqueue(segment); box.completeSessions();
  const pending=box.flush();
  box.deleteSession("s");release();await pending;
  expect(remote.delete).toHaveBeenCalledWith("a","s");
  expect(box.pending).toBe(0);
});
