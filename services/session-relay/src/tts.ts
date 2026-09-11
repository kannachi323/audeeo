import type { Segment } from "../../../shared/pipeline";
import { languageNames } from "../../../shared/translation";
/** Server-only Qwen streaming TTS adapter. Feature-gated until native route tests pass. */
export async function synthesizeCommitted(
  segment: Segment,
  apiKey: string,
  endpoint: string,
  onPCM: (base64: string) => void,
  connect: typeof fetch = fetch,
): Promise<void> {
  if (
    !segment.final ||
    segment.state !== "complete" ||
    !segment.translatedText.trim()
  )
    throw new Error("Speech requires a committed translation");
  if (
    ![
      "https://dashscope-intl.aliyuncs.com/api-ws/v1/realtime",
      "https://dashscope.aliyuncs.com/api-ws/v1/realtime",
    ].includes(endpoint)
  )
    throw new Error("Unsupported TTS region");
  const r = await connect(`${endpoint}?model=qwen3-tts-flash-realtime`, {
    headers: { Authorization: `Bearer ${apiKey}`, Upgrade: "websocket" },
    signal: AbortSignal.timeout(8000),
  });
  const ws = r.webSocket;
  if (r.status !== 101 || !ws) throw new Error("Speech could not connect");
  ws.accept();
  await new Promise<void>((resolve, reject) => {
    let complete = false,
      bytes = 0,
      configured = false;
    const timer = setTimeout(() => finish(Error("Speech timed out")), 15000);
    const send = (value: Record<string, unknown>) =>
      ws.send(JSON.stringify({ event_id: crypto.randomUUID(), ...value }));
    const finish = (error?: Error) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      try {
        ws.close(1000, "Speech ended");
      } catch {}
      error ? reject(error) : resolve();
    };
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || complete) return;
      try {
        const e = JSON.parse(event.data) as { type: string; delta?: string };
        if (e.type === "session.updated" && !configured) {
          configured = true;
          send({
            type: "input_text_buffer.append",
            text: segment.translatedText,
          });
          send({ type: "input_text_buffer.commit" });
          send({ type: "session.finish" });
        }
        if (e.type === "response.audio.delta" && e.delta) {
          bytes += e.delta.length;
          if (bytes > 4_000_000)
            throw new Error("Speech exceeds the playback buffer");
          onPCM(e.delta);
        }
        if (e.type === "session.finished") finish();
        if (e.type === "error")
          finish(Error("Speech failed. Captions remain available."));
      } catch (e) {
        finish(e instanceof Error ? e : Error("Invalid speech response"));
      }
    });
    ws.addEventListener("error", () => finish(Error("Speech connection lost")));
    ws.addEventListener("close", () => {
      if (!complete) finish(Error("Speech ended before completion"));
    });
    send({
      type: "session.update",
      session: {
        voice: "Cherry",
        mode: "commit",
        language_type: languageNames[segment.targetLanguage],
        response_format: "pcm",
        sample_rate: 24000,
      },
    });
  });
}
