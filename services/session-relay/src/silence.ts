import { defaultSilence, silenceSettings, type SilenceSettings } from "../../../shared/silence";
/** Input inactivity guard, independent of provider turns and playback gain.
 * dBFS measures digital signal level, not acoustic sound pressure.
 */
export const SILENCE_TIMEOUT_MS = 30_000;
export const SILENCE_THRESHOLD_DBFS = -60;


export class SilenceGuard {
  private lastActivity: number;
  private settings: SilenceSettings;
  private thresholdSquared: number;
  constructor(startedAt: number, settings: unknown = defaultSilence) {
    this.lastActivity = startedAt;
    this.settings = silenceSettings(settings);
    this.thresholdSquared = 10 ** (this.settings.thresholdDbfs / 10) * 32768 ** 2;
  }

  observe(audio: ArrayBuffer | ArrayBufferView, now: number) {
    const view = audio instanceof ArrayBuffer
      ? new DataView(audio)
      : new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
    // Short windows avoid diluting a brief sound inside a large packet.
    for (let offset = 0; offset < view.byteLength; offset += 640) {
      const end = Math.min(offset + 640, view.byteLength);
      let energy = 0;
      for (let i = offset; i + 1 < end; i += 2) {
        const sample = view.getInt16(i, true);
        energy += sample * sample;
      }
      if (end > offset && energy / ((end - offset) / 2) >= this.thresholdSquared) {
        this.lastActivity = now;
        return;
      }
    }
  }

  expired(now: number) { return now - this.lastActivity >= this.settings.timeoutSeconds * 1000; }
}
