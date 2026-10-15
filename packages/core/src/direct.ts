import { AudioEncoder, OpenAICaptions, sessionConfig } from "./openai";
import { identityFormat, type Language, type Segment, type SegmentFormat } from "./segment";
import { SonioxCaptions, sonioxConfig, type SonioxContext, type SonioxResult } from "./soniox";

/** A provider WebSocket, supplied by the host app (browser, Tauri, Node). */
export type SocketMessage = { type: "Text"; data: string } | { type: "Close" } | { type: string; data?: unknown };
export interface ProviderSocket {
  addListener(callback: (message: SocketMessage) => void): () => void;
  send(data: string | number[]): Promise<void>;
  disconnect(): Promise<void>;
}
export type SocketFactory = (url: string, config?: { headers?: Record<string, string> }) => Promise<ProviderSocket>;

export type CaptionEvent =
  | { type: "ready"; sessionId: string }
  | { type: "segment"; segment: Segment }
  | { type: "audio"; pcm: string; sampleRate: 24000 }
  | { type: "audio_reset" }
  | { type: "error"; message: string }
  | { type: "finished"; reason: string };

export type Silence = { timeoutSeconds: number; thresholdDbfs: number };
export const defaultSilence: Silence = { timeoutSeconds: 30, thresholdDbfs: -60 };

export type DirectProvider = "soniox" | "openai";
export type DirectOptions = {
  silence?: Silence;
  /** Plays translated speech (OpenAI translation only). */
  voice?: boolean;
  context?: SonioxContext;
  diarization?: boolean;
  /** Whether a language pair needs translation; defaults to source !== target. */
  translates?: (source: Language, target: Language) => boolean;
  format?: SegmentFormat;
};

/**
 * Connects straight to a speech provider with the caller's key. The socket
 * comes from the host, so this works in a browser, a desktop shell or Node.
 * Unconfirmed text is never promoted to final on a disconnect.
 */
export class DirectCaptionClient {
  protected socket?: ProviderSocket;
  private unlisten?: () => void;
  private ended = false;
  private stopping = false;
  private finishReason = "stopped";
  protected voice = false;
  protected translating = false;
  private queue = Promise.resolve();
  private buffered = 0;
  private elapsed = 0;
  private samples = 0;
  private lastSpeech = 0;
  private silence = defaultSilence;
  private encoder = new AudioEncoder();
  private captions?: SonioxCaptions | OpenAICaptions;
  private endedPromise: Promise<void>;
  private resolveEnded!: () => void;
  private rejectConnect?: (error: Error) => void;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setInterval>;

  constructor(
    protected provider: DirectProvider,
    private key: string,
    protected emit: (event: CaptionEvent) => void,
    private connectSocket: SocketFactory,
  ) {
    this.endedPromise = new Promise((resolve) => { this.resolveEnded = resolve; });
  }

  async start(source: Language, target: Language, options: DirectOptions = {}) {
    this.silence = options.silence ?? defaultSilence;
    this.translating = (options.translates ?? ((s, t) => s !== t))(source, target);
    this.voice = this.provider === "openai" && this.translating && !!options.voice;
    const id = crypto.randomUUID();
    const format = options.format ?? identityFormat;
    const publish = (segment: Segment) => this.emit({ type: "segment", segment });
    this.captions = this.provider === "soniox"
      ? new SonioxCaptions(id, source, target, publish, { format })
      : new OpenAICaptions(id, source, target, publish, { format, translating: this.translating });
    const endpoint = this.provider === "soniox"
      ? "wss://stt-rt.soniox.com/transcribe-websocket"
      : this.translating
        ? "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"
        : "wss://api.openai.com/v1/realtime?intent=transcription";
    await new Promise<void>((resolve, reject) => {
      this.rejectConnect = reject;
      this.readyTimer = setTimeout(() => this.fail("The provider did not connect. Check your key, credits, and network."), 20000);
      const ready = () => {
        if (this.ended || this.stopping) return;
        clearTimeout(this.readyTimer); this.rejectConnect = undefined;
        this.lastSpeech = Date.now();
        this.idleTimer = setInterval(() => {
          if (!this.stopping && Date.now() - this.lastSpeech >= this.silence.timeoutSeconds * 1000) void this.finish("silence timeout");
        }, 1000);
        this.emit({ type: "ready", sessionId: id }); resolve();
      };
      const headers = this.provider === "openai" ? { headers: { Authorization: `Bearer ${this.key}` } } : undefined;
      void this.connectSocket(endpoint, headers).then(async (socket) => {
        if (this.ended || this.stopping) { await socket.disconnect(); return; }
        this.socket = socket;
        this.unlisten = socket.addListener((message) => this.receive(message, ready));
        const config = this.provider === "soniox"
          ? { api_key: this.key, ...sonioxConfig(source, this.translating ? target : source, { context: options.context, diarization: options.diarization }) }
          : sessionConfig(source, target, this.translating);
        await socket.send(JSON.stringify(config));
        if (this.provider === "soniox") ready();
      }).catch(() => this.fail("Could not connect to the provider. Check your API key and network."));
    });
    this.key = "";
  }

  private receive(message: SocketMessage, ready: () => void) {
    if (this.ended) return;
    if (message.type === "Close") {
      if (!this.stopping) this.fail("Provider connection closed. Start again to reconnect.");
      else this.end(this.finishReason);
      return;
    }
    if (message.type !== "Text" || typeof message.data !== "string") return;
    try {
      const event = JSON.parse(message.data);
      if (event.error_code || event.type === "error") { this.fail("Provider request failed. Check your key, balance, and selected languages."); return; }
      if (this.provider === "soniox") {
        if (Array.isArray(event.tokens)) {
          (this.captions as SonioxCaptions).ingest(event as SonioxResult, this.elapsed);
          if (event.tokens.some((token: { text: string }) => token.text === "<end>" || token.text === "<fin>")) this.captions?.flush();
        }
        if (event.finished) this.end(this.finishReason);
        return;
      }
      if (event.type === "session.updated" && this.rejectConnect) ready();
      (this.captions as OpenAICaptions).ingest(event, this.elapsed);
      if (event.type === "session.output_audio.delta" && typeof event.delta === "string" && this.voice) this.emit({ type: "audio", pcm: event.delta, sampleRate: 24000 });
      if (event.type === "session.closed" || (this.stopping && !this.translating && event.type === "conversation.item.input_audio_transcription.completed")) this.end(this.finishReason);
    } catch { this.fail("The provider returned an invalid response. Restart the session."); }
  }

  /** Turns translated speech on or off; returns the resulting state. */
  setVoice(enabled: boolean) {
    this.voice = this.provider === "openai" && this.translating && enabled;
    if (!this.voice) this.emit({ type: "audio_reset" });
    return this.voice;
  }

  sendAudio(pcm: Int16Array) {
    if (this.stopping || this.ended || !this.socket) return;
    let square = 0; for (const sample of pcm) square += (sample / 32768) ** 2;
    if (10 * Math.log10(square / Math.max(1, pcm.length)) >= this.silence.thresholdDbfs) this.lastSpeech = Date.now();
    this.samples += pcm.length; this.elapsed = this.samples / 16;
    const data = this.provider === "soniox"
      ? Array.from(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
      : JSON.stringify({ type: this.translating ? "session.input_audio_buffer.append" : "input_audio_buffer.append", audio: this.encoder.encode(pcm) });
    this.buffered += data.length;
    if (this.buffered > 256000) { this.fail("The network cannot keep up with audio. Capture stopped; reconnect and retry."); return; }
    this.queue = this.queue
      .then(async () => { if (!this.ended) await this.socket?.send(data); })
      .catch(() => this.fail("Sending audio failed. Check your connection and restart."))
      .finally(() => { this.buffered -= data.length; });
  }

  private fail(message: string) {
    if (this.ended) return;
    this.rejectConnect?.(new Error(message)); this.rejectConnect = undefined;
    this.emit({ type: "error", message }); this.end(message);
  }

  private end(reason: string) {
    if (this.ended) return;
    this.ended = true; this.key = "";
    clearTimeout(this.readyTimer); clearInterval(this.idleTimer);
    this.captions?.flush(); this.unlisten?.(); this.unlisten = undefined;
    void this.socket?.disconnect().catch(() => {});
    this.resolveEnded(); this.emit({ type: "finished", reason });
  }

  async finish(reason = "stopped") {
    if (this.ended) return;
    if (this.stopping) return this.endedPromise;
    this.finishReason = reason; this.stopping = true; clearInterval(this.idleTimer);
    if (this.rejectConnect) { this.rejectConnect(new Error("Connection cancelled.")); this.rejectConnect = undefined; this.end(reason); return; }
    if (!this.socket) { this.end(reason); return; }
    await this.queue;
    if (this.ended) return;
    try {
      if (this.provider === "soniox") await this.socket.send("");
      else if (this.translating) await this.socket.send(JSON.stringify({ type: "session.close" }));
      else if (this.samples >= 1600) await this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      else { this.end(reason); return; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.endedPromise, new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.emit({ type: "error", message: "Provider finalization timed out. The last captions may be incomplete." });
          this.end(reason); resolve();
        }, 10000);
      })]);
      clearTimeout(timer);
    } catch { this.fail("Could not finish the provider session. The last captions may be incomplete."); }
  }
}
