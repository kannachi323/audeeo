import {NativeCapture, type AudioInput, type CaptureGains, type InputMode} from './platform';

/** One native source, forwarded on its audio clock without buffering or timers. */
export class DesktopCapture implements AudioInput {
  private capture?: AudioInput;
  private accepting = false;

  constructor(private input: InputMode, private sourceId: string, private gains: CaptureGains) {}

  setGains(gains: CaptureGains) { this.gains = gains; }

  async start(onChunk: (pcm: Int16Array) => void, onError: (error: string) => void) {
    const capture = new NativeCapture(this.input, this.sourceId);
    this.capture = capture;
    let failed = false;
    const fail = (message: string) => {
      if (failed || this.capture !== capture) return;
      failed = true;
      void this.stop();
      onError(message);
    };
    try {
      await capture.start(pcm => {
        if (!this.accepting || this.capture !== capture || !pcm.length) return;
        try {
          const value = this.gains[this.input];
          const gain = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
          onChunk(gain === 1 ? pcm : Int16Array.from(pcm, sample => Math.round(sample * gain)));
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Audio capture failed. Start again.');
        }
      }, fail);
      if (this.capture === capture) this.accepting = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.accepting = false;
    const capture = this.capture;
    this.capture = undefined;
    if (capture) await Promise.allSettled([capture.stop()]);
  }
}
