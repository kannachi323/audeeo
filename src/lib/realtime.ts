import { defaultSilence, type SilenceSettings } from "../../shared/silence";
import type { Language, Segment } from "../../shared/pipeline";
import type {SessionBillingOptions} from "../../shared/minutePacks";
import type { SessionContext } from "../../shared/context";
import { config } from "./config";
export type RelayEvent =
  | {type:'billing'; voiceEnabled:boolean; rate:1|3; paused:boolean;allowPurchasedMinutes:boolean;message?:string}
  | {type:'pack_consent_required'}
  | {type:'audio_reset'}
  | { type: "audio"; pcm: string; sampleRate: 24000 }
  | { type: "ready"; sessionId: string }
  | { type: "segment"; segment: Segment }
  | { type: "error"; message: string }
  | { type: "status"; state: string; message: string }
  | { type: "finished"; reason: string };
export class RealtimeTranslationClient {
  private socket?: WebSocket;
  private finished?: Promise<void>;
  private resolveFinished?: () => void;
  private ready = false;
  private paused = false;
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
    billing?: SessionBillingOptions,
    context?: SessionContext,
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
            ...billing,
            sandbox: config.billingEnvironment === 'sandbox',
            ...(context ? {context} : {}),
          }),
        ),
      );
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data) as RelayEvent;
          if(message.type==='billing')this.paused=message.paused;
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
  control(message:{type:"voice";enabled:boolean}|{type:"use_packs"}) {
    try { if(this.socket?.readyState!==WebSocket.OPEN)throw new Error('closed');this.socket.send(JSON.stringify(message)); }
    catch {this.onEvent({type:'status',state:'control_failed',message:'Could not update session usage. Retry the control.'});}
  }
  sendAudio(pcm: Int16Array) {
    if (this.paused || !this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
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
  connect(token: string, source: Language, target: Language, silence?: SilenceSettings, billing?: SessionBillingOptions, context?: SessionContext): Promise<void>;
  control(message:{type:"voice";enabled:boolean}|{type:"use_packs"}):void;
  sendAudio(pcm: Int16Array): void;
  finish(): Promise<void>;
}
