import { defaultSilence, type SilenceSettings } from "../../shared/silence";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Language, Segment } from "../../shared/pipeline";
export type RelayEvent =
  | { type: "audio"; pcm: string; sampleRate: 24000 }
  | { type: "ready"; sessionId: string }
  | { type: "segment"; segment: Segment }
  | { type: "error"; message: string }
  | { type: "finished"; reason: string };
export type ProviderCredentials = {
  provider: "openai" | "soniox";
  apiKey: string;
};
export class RealtimeTranslationClient {
  private socket?: WebSocket;
  private finished?: Promise<void>;
  private resolveFinished?: () => void;
  private ready = false;
  private didFinish = false;
  constructor(
    private endpoint: string,
    private onEvent: (event: RelayEvent) => void,
  ) {}
  async connect(
    accessToken: string,
    sourceLanguage: Language,
    targetLanguage: Language,
    silence: SilenceSettings = defaultSilence,
    credentials?: ProviderCredentials,
  ) {
    const url = new URL("/v1/realtime", this.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.binaryType = "arraybuffer";
      const timeout = setTimeout(() => {
        reject(
          new Error("Connection timed out. Check your network and retry."),
        );
        socket.close();
      }, 20000);
      socket.addEventListener("open", () =>
        socket.send(
          JSON.stringify({
            type: "start",
            accessToken,
            sourceLanguage,
            targetLanguage,
            silence,
            ...(credentials?.apiKey ? { provider: credentials.provider, providerKey: credentials.apiKey } : {}),
          }),
        ),
      );
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data) as RelayEvent;
          if (message.type === "ready") {
            this.ready = true;
            clearTimeout(timeout);
            resolve();
          }
          if (message.type === "error" && !this.ready) {
            clearTimeout(timeout);
            reject(new Error(message.message));
          }
          if (message.type === 'finished') {
            this.didFinish = true; this.ready = false; this.resolveFinished?.();
          }
          this.onEvent(message);
        } catch {
          /* Ignore malformed protocol data. */
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Connection failed. Check your network and retry."));
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        if (!this.ready)
          reject(new Error("Connection closed before captions were ready."));
        this.ready = false;
        this.resolveFinished?.();
        if (!this.didFinish) this.onEvent({
          type: "finished",
          reason: "Connection closed. Start again to reconnect.",
        });
      });
    });
  }
  sendAudio(pcm: Int16Array) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 128000) {
      this.onEvent({
        type: "error",
        message:
          "Network is behind. Capture stopped to prevent losing audio silently.",
      });
      this.socket.close();
      return;
    }
    this.socket.send(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    );
  }
  async finish() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "stop" }));
    } else this.socket?.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.finished,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.onEvent({
            type: "error",
            message:
              "Finalization timed out. Some translations may be incomplete.",
          });
          this.socket?.close();
          resolve();
        }, 20000);
      }),
    ]);
    clearTimeout(timer);
  }
}

export interface CaptionConnection {
  connect(token: string, source: Language, target: Language, silence?: SilenceSettings, credentials?: ProviderCredentials): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  finish(): Promise<void>;
}
export class NativeRelayClient implements CaptionConnection {
  private unlisten?: UnlistenFn;
  private ended?: () => void;
  constructor(
    private endpoint: string,
    private onEvent: (event: RelayEvent) => void,
    private owner: string,
    private save: boolean,
  ) {}
  async connect(token: string, source: Language, target: Language, silence: SilenceSettings = defaultSilence, _credentials?: ProviderCredentials) {
    await new Promise<void>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Native session timed out. Retry."));
        void this.finish();
      }, 20000);
      try {
        this.unlisten = await listen<string>(
          "native-session-event",
          ({ payload }) => {
            const e = JSON.parse(payload) as RelayEvent;
            if (e.type === "ready") {
              clearTimeout(timer);
              resolve();
            }
            if (e.type === "error") {
              clearTimeout(timer);
              reject(new Error(e.message));
            }
            if (e.type === "finished") {
              this.ended?.();
              const unlisten = this.unlisten;
              this.unlisten = undefined;
              unlisten?.();
            }
            this.onEvent(e);
          },
        );
        await invoke("start_native_session", {
          endpoint: this.endpoint,
          token,
          source,
          target,
          owner: this.owner,
          save: this.save,
          silenceTimeout: silence.timeoutSeconds,
          silenceThreshold: silence.thresholdDbfs,
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  sendAudio(_pcm: Int16Array) {} // The native capture owner sends audio directly.
  async finish() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = new Promise<void>((resolve) => {
      this.ended = resolve;
      timer = setTimeout(resolve, 21000);
    });
    await invoke("stop_native_session");
    await ended;
    clearTimeout(timer);
    const unlisten = this.unlisten;
    this.unlisten = undefined;
    unlisten?.();
  }
}
