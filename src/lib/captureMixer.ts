import {
  NativeCapture,
  type AudioInput,
  type CaptureGains,
  type InputMode,
} from "./platform";
type CaptureChannel = keyof CaptureGains;

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 320;
const MAX_BUFFERED_SAMPLES = SAMPLE_RATE;
const PREBUFFER_MS = 120;

function normalizedGain(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

class PcmQueue {
  private chunks: Int16Array[] = [];
  private offset = 0;
  private samples = 0;

  push(chunk: Int16Array) {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.samples += chunk.length;
    if (this.samples > MAX_BUFFERED_SAMPLES)
      this.drop(this.samples - MAX_BUFFERED_SAMPLES);
  }

  take(count: number) {
    const result = new Int16Array(count);
    let written = 0;
    while (written < count && this.chunks.length) {
      const first = this.chunks[0];
      const available = first.length - this.offset;
      const length = Math.min(count - written, available);
      result.set(first.subarray(this.offset, this.offset + length), written);
      written += length;
      this.offset += length;
      this.samples -= length;
      if (this.offset === first.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return result;
  }

  clear() {
    this.chunks = [];
    this.offset = 0;
    this.samples = 0;
  }

  private drop(count: number) {
    let remaining = count;
    while (remaining > 0 && this.chunks.length) {
      const first = this.chunks[0];
      const available = first.length - this.offset;
      const length = Math.min(remaining, available);
      this.offset += length;
      this.samples -= length;
      remaining -= length;
      if (this.offset === first.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
  }
}

/**
 * Mixes independently captured desktop PCM without touching either source's
 * audible OS volume. Missing samples become silence and excess samples are
 * bounded so a stalled renderer cannot create unbounded latency.
 */
export class PcmFrameMixer {
  private queues: Record<CaptureChannel, PcmQueue> = {
    microphone: new PcmQueue(),
    system: new PcmQueue(),
  };
  private gains: CaptureGains;

  constructor(gains: CaptureGains) {
    this.gains = {
      microphone: normalizedGain(gains.microphone),
      system: normalizedGain(gains.system),
    };
  }

  setGains(gains: CaptureGains) {
    this.gains = {
      microphone: normalizedGain(gains.microphone),
      system: normalizedGain(gains.system),
    };
  }

  push(channel: CaptureChannel, pcm: Int16Array) {
    this.queues[channel].push(pcm);
  }

  reset() {
    this.queues.microphone.clear();
    this.queues.system.clear();
  }

  renderFrame() {
    const microphone = this.queues.microphone.take(FRAME_SAMPLES);
    const system = this.queues.system.take(FRAME_SAMPLES);
    const mixed = new Float64Array(FRAME_SAMPLES);
    let peak = 0;
    for (let index = 0; index < FRAME_SAMPLES; index++) {
      const sample =
        microphone[index] * this.gains.microphone +
        system[index] * this.gains.system;
      mixed[index] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const limiter = peak > 32_767 ? 32_767 / peak : 1;
    const output = new Int16Array(FRAME_SAMPLES);
    for (let index = 0; index < FRAME_SAMPLES; index++)
      output[index] = Math.max(-32_768, Math.min(32_767, Math.round(mixed[index] * limiter)));
    return output;
  }
}

/** Desktop-only capture owner. Mobile keeps its native single-input session. */
export class DesktopCaptureMixer implements AudioInput {
  private mixer: PcmFrameMixer;
  private captures: AudioInput[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private prebuffer?: ReturnType<typeof setTimeout>;
  private accepting = false;
  private stopped = true;

  constructor(
    private mode: InputMode,
    private sourceId: string,
    gains: CaptureGains,
  ) {
    this.mixer = new PcmFrameMixer(gains);
  }

  setGains(gains: CaptureGains) {
    this.mixer.setGains(gains);
  }

  async start(
    onChunk: (pcm: Int16Array) => void,
    onError: (error: string) => void,
  ) {
    this.stopped = false;
    let failed = false;
    const fail = (error: string) => {
      if (failed) return;
      failed = true;
      onError(error);
    };
    const starts: Promise<void>[] = [];
    if (this.mode !== "system") {
      const microphone = new NativeCapture("microphone");
      this.captures.push(microphone);
      starts.push(microphone.start(
        (pcm) => { if (this.accepting) this.mixer.push("microphone", pcm); },
        fail,
      ));
    }
    if (this.mode !== "microphone") {
      const system = new NativeCapture("system", this.sourceId);
      this.captures.push(system);
      starts.push(system.start(
        (pcm) => { if (this.accepting) this.mixer.push("system", pcm); },
        fail,
      ));
    }
    try {
      await Promise.all(starts);
      if (this.stopped) return;
      this.mixer.reset();
      this.accepting = true;
      // The Windows WebView microphone delivers larger blocks than native
      // loopback capture. Briefly prebuffer both clocks before emitting fixed
      // 20 ms frames so their first samples stay aligned.
      this.prebuffer = setTimeout(() => {
        if (this.stopped) return;
        this.prebuffer = undefined;
        onChunk(this.mixer.renderFrame());
        this.timer = setInterval(() => onChunk(this.mixer.renderFrame()), 20);
      }, PREBUFFER_MS);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.stopped = true;
    this.accepting = false;
    if (this.prebuffer) clearTimeout(this.prebuffer);
    this.prebuffer = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.mixer.reset();
    const captures = this.captures.splice(0);
    await Promise.allSettled(captures.map((capture) => capture.stop()));
  }
}
