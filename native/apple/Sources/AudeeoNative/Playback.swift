import AVFoundation
import Foundation

/// Main-thread owned, bounded playback. Completion callbacks are generation checked after reset.
public final class TranslationPlayback {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    public var maximumSeconds = 60
    private var pendingFrames = 0
    private var generation = 0
    private var releaseSession = false
    private var failed = false
    private var observer: NSObjectProtocol?
    public var onActivity: ((Bool) -> Void)?
    public var onError: ((String) -> Void)?
    public var volume: Float = 1 { didSet { player.volume = min(1, max(0, volume)) } }
    public var active: Bool { pendingFrames > 0 }
    public init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1))
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            guard let self, self.active else { return }
            self.failed = true; self.stop(); self.onError?("Audio device changed. Playback stopped; restart the session.")
        }
    }
    public func enqueue(pcm: Data) throws {
        releaseSession = false
        let frames = pcm.count / 2
        guard !failed, pcm.count % 2 == 0, frames > 0, pendingFrames + frames <= 24000 * maximumSeconds else {
            failed = true
            throw NSError(domain: "Audeeo", code: 20, userInfo: [NSLocalizedDescriptionKey: "Audio exceeded its bounded playback buffer. Restart the session."])
        }
        let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)), let samples = buffer.floatChannelData?[0] else { return }
        let bytes = [UInt8](pcm)
        for i in 0..<frames { samples[i] = Float(Int16(bitPattern: UInt16(bytes[i*2]) | UInt16(bytes[i*2+1]) << 8)) / 32768 }
        buffer.frameLength = AVAudioFrameCount(frames)
        if !engine.isRunning { try engine.start() }
        let run = generation
        let wasActive = active
        pendingFrames += frames
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.generation == run else { return }
                self.pendingFrames = max(0, self.pendingFrames - frames)
                if !self.active { self.onActivity?(false); self.releaseIfFinished() }
            }
        }
        if !player.isPlaying { player.play() }
        if !wasActive { onActivity?(true) }
    }
    public func reset() { stop(); failed = false; releaseSession = false }
    public func finishSession() { releaseSession = true; releaseIfFinished() }
    private func releaseIfFinished() {
        #if os(iOS)
        if releaseSession && !active { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        #endif
    }
    public func stop() {
        generation += 1
        player.stop(); engine.stop(); pendingFrames = 0
        onActivity?(false)
        releaseIfFinished()
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; player.stop(); engine.stop() }
}
let translatedPlayback = TranslationPlayback()
public typealias PlaybackCallback = @convention(c) (Int32) -> Void
@_cdecl("audeeo_playback_command")
public func playbackCommand(_ raw: UnsafePointer<CChar>, _ callback: @escaping PlaybackCallback) {
    let text = String(cString: raw)
    DispatchQueue.main.async {
        translatedPlayback.onActivity = { callback($0 ? 1 : 0) }
        translatedPlayback.onError = { _ in callback(-1) }
        guard let data = text.data(using: .utf8), let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let volume = command["volume"] as? Double { translatedPlayback.volume = Float(volume) }
        if command["reset"] as? Bool == true { translatedPlayback.reset() }
        if command["stop"] as? Bool == true { translatedPlayback.stop() }
        if let base64 = command["pcm"] as? String, let pcm = Data(base64Encoded: base64) {
            do { try translatedPlayback.enqueue(pcm: pcm) }
            catch { translatedPlayback.stop(); callback(-1) }
        }
    }
}
