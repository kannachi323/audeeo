const TARGET_SAMPLE_RATE = 16_000

export type ChunkHandler = (pcm: Int16Array) => void
export type LevelHandler = (level: number) => void

export type AudioInputDevice = {
  deviceId: string
  label: string
}

export async function getAudioInputDevices(): Promise<AudioInputDevice[]> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${index + 1}`,
      }))
  } catch {
    return []
  }
}

function downsampleToPcm16(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === TARGET_SAMPLE_RATE) {
    const pcm = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return pcm
  }

  const ratio = inputRate / TARGET_SAMPLE_RATE
  const outputLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Int16Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) {
      sum += input[j]
    }
    const sample = sum / Math.max(1, end - start)
    const clamped = Math.max(-1, Math.min(1, sample))
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }

  return output
}

export class PcmCapture {
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private processor?: ScriptProcessorNode
  private sink?: GainNode
  private mediaStream?: MediaStream

  async startMicrophone(
    onChunk: ChunkHandler,
    onLevel?: LevelHandler,
    deviceId?: string,
  ) {
    const audioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    }

    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId }
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    })

    await this.setupAudioContext(this.mediaStream, onChunk, onLevel)
  }

  async startDisplay(onChunk: ChunkHandler, onLevel?: LevelHandler) {
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen audio capture is not available in this environment.')
    }

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { frameRate: 2 },
    })

    if (this.mediaStream.getAudioTracks().length === 0) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = undefined
      throw new Error(
        'Screen audio capture is unavailable in this environment. Switch to "Microphone" to capture audio.',
      )
    }

    await this.setupAudioContext(this.mediaStream, onChunk, onLevel)
    return this.mediaStream
  }

  private async setupAudioContext(
    stream: MediaStream,
    onChunk: ChunkHandler,
    onLevel?: LevelHandler,
  ) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

    try {
      this.context = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE })
    } catch {
      this.context = new AudioCtx()
    }

    await this.context.resume()

    this.source = this.context.createMediaStreamSource(stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)

    // Keep global reference so WebKit garbage collection never drops the processor
    ;(window as unknown as { __audeeo_proc?: ScriptProcessorNode }).__audeeo_proc =
      this.processor

    this.sink = this.context.createGain()
    this.sink.gain.value = 1.0

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      const inputRate = event.inputBuffer.sampleRate

      // Calculate real-time RMS volume for the VU meter
      if (onLevel) {
        let sumSquares = 0
        for (let i = 0; i < input.length; i++) {
          sumSquares += input[i] * input[i]
        }
        const rms = Math.sqrt(sumSquares / input.length)
        // Normalize 0 to 100 with a logarithmic-like boost for visual clarity
        const level = Math.min(100, Math.round(Math.pow(rms, 0.6) * 120))
        onLevel(level)
      }

      // Convert to 16 kHz 16-bit PCM
      const pcm = downsampleToPcm16(input, inputRate)
      onChunk(pcm)

      // Zero out the output buffer to avoid speaker feedback while keeping WebKit rendering active
      const output = event.outputBuffer.getChannelData(0)
      output.fill(0)
    }

    this.source.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(this.context.destination)
  }

  async stop() {
    ;(window as unknown as { __audeeo_proc?: ScriptProcessorNode }).__audeeo_proc =
      undefined

    this.processor?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.mediaStream?.getTracks().forEach((track) => track.stop())
    await this.context?.close().catch(() => undefined)

    this.processor = undefined
    this.source = undefined
    this.sink = undefined
    this.mediaStream = undefined
    this.context = undefined
  }
}
