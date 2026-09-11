import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SourceResampler } from "./presentation";
import { PcmCapture } from "./audio";
export type Capabilities = {
  platform: string;
  microphone: boolean;
  systemAudio: boolean;
  globalOverlay: boolean;
  nativePip?: boolean;
  nativeSession?: boolean;
};
export interface AudioInput {
  start(
    onChunk: (pcm: Int16Array) => void,
    onError: (error: string) => void,
  ): Promise<void>;
  stop(): Promise<void>;
}
export async function capabilities(): Promise<Capabilities> {
  if (!isTauri())
    return {
      platform: "browser",
      microphone: !!navigator.mediaDevices?.getUserMedia,
      systemAudio: false,
      globalOverlay: false,
    };
  return invoke("platform_capabilities");
}
export class NativeCapture implements AudioInput {
  private listeners: UnlistenFn[] = [];
  private cancelled = false;
  private resampler = new SourceResampler();
  constructor(private input: "microphone" | "system") {}
  async start(
    onChunk: (pcm: Int16Array) => void,
    onError: (message: string) => void,
  ) {
    this.cancelled = false;
    this.listeners.push(
      await listen<{ data: string; sampleRate?: number }>(
        `${this.input === "system" ? "system-audio" : "microphone"}-chunk`,
        ({ payload }) => {
          if (this.cancelled) return;
          const bytes = Uint8Array.from(atob(payload.data), (c) =>
            c.charCodeAt(0),
          );
          const pcm = new Int16Array(bytes.buffer);
          onChunk(payload.sampleRate === 24000 ? this.resampler.convert(pcm) : pcm);
        },
      ),
    );
    this.listeners.push(
      await listen<string>("capture-error", ({ payload }) => onError(payload)),
    );
    if (this.cancelled) {
      await this.stop();
      return;
    }
    let ready!: () => void, failed!: (error: Error) => void;
    const permission = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    this.listeners.push(await listen(this.input === "system" ? "system-ready" : "microphone-ready", () => ready()));
    this.listeners.push(
      await listen<string>("capture-error", ({ payload }) =>
        failed(new Error(payload)),
      ),
    );
    const timeout = setTimeout(
      () =>
        failed(
          new Error(
            "Microphone permission is pending. Allow access and start again.",
          ),
        ),
      20000,
    );
    try {
      await invoke(this.input === "system" ? "start_system_audio_capture" : "start_microphone_capture");
      await permission;
    } finally {
      clearTimeout(timeout);
    }
  }
  async stop() {
    this.cancelled = true;
    try { await invoke(
      this.input === "system"
        ? "stop_system_audio_capture"
        : "stop_microphone_capture",
    );
    } finally { this.listeners.splice(0).forEach((f) => f()); }
  }
}
export class BrowserMicrophone implements AudioInput {
  private capture = new PcmCapture();
  async start(onChunk: (pcm: Int16Array) => void) {
    await this.capture.startMicrophone(onChunk);
  }
  async stop() {
    await this.capture.stop();
  }
}
