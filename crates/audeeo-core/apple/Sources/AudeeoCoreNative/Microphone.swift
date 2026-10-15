import AVFoundation
import Foundation

/// The default input device as 16 kHz mono PCM16. Ported from Audeeo's
/// MicrophoneCapture; delivery goes straight to the caller, not the main queue.
final class MicrophoneCapture: AudeeoCapture {
    private let engine = AVAudioEngine()
    private let delivery: AudeeoDelivery
    private var installed = false
    private var observer: NSObjectProtocol?

    init(delivery: AudeeoDelivery) {
        self.delivery = delivery
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { [weak self] _ in
            // The input device changed under us. Report it; the caller decides
            // whether to reopen.
            guard let self, self.installed else { return }
            self.delivery.fail()
        }
    }

    func start() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0,
              let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: format, to: output) else {
            throw NSError(domain: "AudeeoCore", code: Int(AudeeoStatus.device.rawValue))
        }
        let delivery = self.delivery
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
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
            guard error == nil, let samples = pcm.int16ChannelData, pcm.frameLength > 0 else { return }
            delivery.send(samples[0], count: Int(pcm.frameLength))
        }
        installed = true
        do { try engine.start() } catch { stop(); throw error }
    }

    func stop() {
        delivery.close()
        engine.stop()
        if installed { engine.inputNode.removeTap(onBus: 0); installed = false }
        if let observer { NotificationCenter.default.removeObserver(observer); self.observer = nil }
    }
}

/// Asks for microphone access when needed. Off the main thread this waits
/// for the user's answer; on the main thread it never blocks and reports
/// "denied" until access is granted.
private func microphoneAllowed() -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined:
        if Thread.isMainThread {
            AVCaptureDevice.requestAccess(for: .audio) { _ in }
            return false
        }
        let answered = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { allowed in granted = allowed; answered.signal() }
        return answered.wait(timeout: .now() + 60) == .success && granted
    default: return false
    }
}

@_cdecl("audeeo_core_mic_start")
public func audeeoCoreMicStart(
    _ context: UnsafeMutableRawPointer?,
    _ callback: @escaping AudeeoPCMCallback,
    _ status: UnsafeMutablePointer<Int32>
) -> UnsafeMutableRawPointer? {
    guard microphoneAllowed() else { status.pointee = AudeeoStatus.denied.rawValue; return nil }
    let capture = MicrophoneCapture(delivery: AudeeoDelivery(context: context, callback: callback))
    do {
        try capture.start()
        status.pointee = AudeeoStatus.ok.rawValue
        return retain(capture)
    } catch {
        status.pointee = AudeeoStatus.device.rawValue
        return nil
    }
}
