import { it, expect, vi } from "vitest";
import { synthesizeCommitted } from "../services/session-relay/src/tts";
import type { Segment } from "../shared/pipeline";
const segment: Segment = {
  id: "one",
  sessionId: "s",
  sequence: 1,
  revision: 1,
  startMs: 0,
  endMs: 1000,
  sourceLanguage: "en",
  targetLanguage: "zh",
  sourceText: "Hello",
  translatedText: "你好",
  final: true,
  state: "complete",
};
it("never synthesizes provisional or failed translations", async () => {
  const connect = vi.fn();
  await expect(
    synthesizeCommitted(
      { ...segment, final: false },
      "secret",
      "https://dashscope-intl.aliyuncs.com/api-ws/v1/realtime",
      vi.fn(),
      connect,
    ),
  ).rejects.toThrow("committed");
  expect(connect).not.toHaveBeenCalled();
});
it("uses the documented streaming TTS handshake and only forwards PCM deltas", async () => {
  const listeners = new Map<string, (event: any) => void>();
  const sent: any[] = [];
  const audio = vi.fn();
  const ws = {
    accept: vi.fn(),
    close: vi.fn(),
    addEventListener: (name: string, callback: (event: any) => void) =>
      listeners.set(name, callback),
    send: (raw: string) => {
      const e = JSON.parse(raw);
      sent.push(e);
      if (e.type === "session.update")
        queueMicrotask(() =>
          listeners.get("message")?.({
            data: JSON.stringify({ type: "session.updated" }),
          }),
        );
      if (e.type === "session.finish")
        queueMicrotask(() => {
          listeners.get("message")?.({
            data: JSON.stringify({
              type: "response.audio.delta",
              delta: "AAAA",
            }),
          });
          listeners.get("message")?.({
            data: JSON.stringify({ type: "session.finished" }),
          });
        });
    },
  };
  const connect = vi.fn(async () => ({ status: 101, webSocket: ws })) as any;
  await synthesizeCommitted(
    segment,
    "server-key",
    "https://dashscope-intl.aliyuncs.com/api-ws/v1/realtime",
    audio,
    connect,
  );
  expect(sent.map((e) => e.type)).toEqual([
    "session.update",
    "input_text_buffer.append",
    "input_text_buffer.commit",
    "session.finish",
  ]);
  expect(sent[0].session).toMatchObject({
    voice: "Cherry",
    language_type: "Chinese",
    mode: "commit",
    sample_rate: 24000,
  });
  expect(sent[1].text).toBe("你好");
  expect(audio).toHaveBeenCalledWith("AAAA");
});
