import AVFoundation
import Foundation

public final class MicrophoneCapture {
    private let engine = AVAudioEngine()
    private var installed = false
    public var onError: (() -> Void)?
    private var observer: NSObjectProtocol?
    public init() {
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            guard let self, self.installed else { return }
            self.stop(); self.onError?()
        }
    }
    public func start(onPCM: @escaping (Data) -> Void) throws {
        guard !installed else { return }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0,
              let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: format, to: output) else {
            throw NSError(domain: "Audeeo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone format is unavailable. Check the selected input device."])
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
            let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000 / format.sampleRate) + 32)
            guard let pcm = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return }
            var supplied = false
            var error: NSError?
            converter.convert(to: pcm, error: &error) { _, status in
                if supplied { status.pointee = .noDataNow; return nil }
                supplied = true
                status.pointee = .haveData
                return buffer
            }
            guard error == nil, let bytes = pcm.int16ChannelData, pcm.frameLength > 0 else { return }
            onPCM(Data(bytes: bytes[0], count: Int(pcm.frameLength) * 2))
        }
        installed = true
        do { try engine.start() } catch { stop(); throw error }
    }
    public func stop() {
        engine.stop()
        if installed { engine.inputNode.removeTap(onBus: 0); installed = false }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; stop() }
}
#if os(macOS)
private let microphone = MicrophoneCapture()
private var microphoneGeneration = 0
public typealias AudioCallback = @convention(c) (UnsafePointer<UInt8>?, Int, Int32) -> Void
@_cdecl("audeeo_microphone_start")
public func microphoneStart(_ callback: @escaping AudioCallback) {
    DispatchQueue.main.async {
    microphoneGeneration += 1
    let run = microphoneGeneration
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        DispatchQueue.main.async {
            guard run == microphoneGeneration else { return }
            guard granted else { callback(nil, 0, 1); return }
            do {
                microphone.onError = { callback(nil, 0, 2) }
                try microphone.start { data in data.withUnsafeBytes { callback($0.bindMemory(to: UInt8.self).baseAddress, data.count, 0) } }
                callback(nil, 0, 0)
            } catch { callback(nil, 0, 2) }
        }
    }
}
}
@_cdecl("audeeo_microphone_stop")
public func microphoneStop() { DispatchQueue.main.async { microphoneGeneration += 1; microphone.stop() } }
#endif
