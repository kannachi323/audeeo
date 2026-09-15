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
  applicationAudio?: boolean;
  inputMix?: boolean;
  translatedPlayback?: boolean;
};
export type CaptureApplication = { id: string; name: string };
export type InputMode = "microphone" | "system" | "mixed";
export type CaptureGains = { microphone: number; system: number };
export type CaptureSources = {
  microphone: string;
  applications: string[];
  captureSources?: CaptureApplication[];
};

export function systemAudioLabel(platform: string) {
  if (platform === "macos" || platform === "windows")
    return "Desktop audio (all apps)";
  if (platform === "android") return "Device audio (allowed apps)";
  if (platform === "ios") return "Device playback (system picker)";
  return "Device audio";
}

export function systemAudioDescription(platform: string) {
  if (platform === "macos" || platform === "windows")
    return "Captures all desktop playback, or choose one active application below.";
  if (platform === "android")
    return "Captures playback that Android and the source app allow after system approval.";
  if (platform === "ios")
    return "Opens Apple’s system picker and captures the device playback you approve.";
  return "Playback capture isn’t available on this device.";
}
export interface AudioInput {
  start(
    onChunk: (pcm: Int16Array) => void,
    onError: (error: string) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  setGains?(gains: CaptureGains): void;
}
export async function capabilities(): Promise<Capabilities> {
  if (!isTauri())
    return {
      platform: "browser",
      microphone: !!navigator.mediaDevices?.getUserMedia,
      systemAudio: false,
      globalOverlay: false,
      applicationAudio: false,
      inputMix: false,
      translatedPlayback: true,
    };
  return invoke("platform_capabilities");
}
export class NativeCapture implements AudioInput {
  private listeners: UnlistenFn[] = [];
  private cancelled = false;
  private resampler = new SourceResampler();
  constructor(private input: "microphone" | "system", private sourceId = "all") {}
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
            this.input === "system"
              ? "Desktop audio permission is pending. Allow access and start again."
              : "Microphone permission is pending. Allow access and start again.",
          ),
        ),
      20000,
    );
    try {
    await invoke(
      this.input === "system" ? "start_system_audio_capture" : "start_microphone_capture",
      this.input === "system" ? {sourceId: this.sourceId === "all" ? null : this.sourceId} : undefined,
    );
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
