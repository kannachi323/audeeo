#if os(iOS)
import AVFoundation
import AVKit
import Foundation
import UIKit

/// Native capture, relay networking, and PiP continue independently of React execution.
@available(iOS 27.0, *)
final class NativeCaptionSession {
    let mic = MicrophoneCapture()
    let screenAudio = ScreenAudioCapture()
    let pip = SubtitlePiP()
    var socket: URLSessionWebSocketTask?
    var onEvent: ((String) -> Void)?
    var stopping = false
    var pendingBytes = 0
    var translation = ""
    var history: NativeHistory?
    var generation = 0
    var input = "microphone"
    var observers: [NSObjectProtocol] = []
    func start(endpoint: URL, token: String, source: String, target: String, silenceTimeout: Int32, silenceThreshold: Int32, provider: String, providerKey: String, context: String, input: String) {
        translatedPlayback.reset()
        generation += 1
        let run = generation
        stopping = false
        translation = ""
        self.input = input
        if input == "system" {
            screenAudio.onAudio = { [weak self] data in self?.sendAudio(data, run: run) }
            screenAudio.onStarted = { [weak self] in
                self?.connectRelay(endpoint: endpoint, token: token, source: source, target: target, silenceTimeout: silenceTimeout, silenceThreshold: silenceThreshold, provider: provider, providerKey: providerKey, context: context, run: run)
            }
            screenAudio.onError = { [weak self] message in self?.fail(message) }
            screenAudio.presentPicker()
            return
        }
        connectRelay(endpoint: endpoint, token: token, source: source, target: target, silenceTimeout: silenceTimeout, silenceThreshold: silenceThreshold, provider: provider, providerKey: providerKey, context: context, run: run)
    }
    func connectRelay(endpoint: URL, token: String, source: String, target: String, silenceTimeout: Int32, silenceThreshold: Int32, provider: String, providerKey: String, context: String, run: Int) {
        guard run == generation, !stopping else { return }
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
        components.scheme = endpoint.scheme == "https" ? "wss" : "ws"
        components.path = "/v1/realtime"
        guard let url = components.url else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        var start: [String: Any] = ["type": "start", "accessToken": token, "sourceLanguage": source, "targetLanguage": target, "silence": ["timeoutSeconds": silenceTimeout, "thresholdDbfs": silenceThreshold]]
        if !provider.isEmpty && !providerKey.isEmpty {
            start["provider"] = provider
            start["providerKey"] = providerKey
        }
        if let contextData = context.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: contextData), !(value is NSNull) { start["context"] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: start), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { [weak self] error in
            if error != nil { DispatchQueue.main.async { self?.fail("Could not connect. Check your network and retry.") } }
        }
        receive(run: run)
        for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                if notification.name == AVAudioSession.routeChangeNotification {
                    guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                          let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
                          reason == .oldDeviceUnavailable || reason == .newDeviceAvailable else { return }
                } else {
                    guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                          AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
                }
                self?.fail("Audio route changed or capture was interrupted. Check your headphones and restart captions.")
            })
        }
    }
    func receive(run: Int) {
        socket?.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, run == self.generation else { return }
                switch result {
                case .failure: self.fail("Caption connection ended. Reconnect to continue.")
                case .success(let message):
                    guard case .string(let text) = message, let data = text.data(using: .utf8), let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { self.receive(run: run); return }
                    if let segment = event["segment"] as? [String: Any] {
                        do { try self.history?.enqueue(segment) }
                        catch { self.fail("Offline history could not be saved. Open Audeeo to sync before continuing."); return }
                    }
                    if event["type"] as? String == "audio", let encoded = event["pcm"] as? String, let pcm = Data(base64Encoded: encoded) {
                        do { try translatedPlayback.enqueue(pcm: pcm) }
                        catch { self.fail("Translated audio playback failed."); return }
                    }
                    if event["type"] as? String != "ready" { self.onEvent?(text) }
                    if event["type"] as? String == "ready" {
                        if let root = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController?.view { self.pip.attach(to: root) }
                        if self.input == "system" { self.onEvent?(text) }
                        else { self.beginMicrophone(readyEvent: text, run: run) }
                    }
                    if event["type"] as? String == "segment", let segment = event["segment"] as? [String: Any] {
                        if let text = segment["translatedText"] as? String, !text.isEmpty { self.translation = text }
                        self.pip.update(source: segment["sourceText"] as? String ?? "", translation: self.translation)
                    }
                    if event["type"] as? String == "finished" { self.dispose(); return }
                    self.receive(run: run)
                }
            }
        }
    }
    func beginMicrophone(readyEvent: String, run: Int) {
        guard run == generation, !stopping else { return }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                guard run == self.generation, !self.stopping else { return }
                guard granted else { self.fail("Allow microphone access in Settings to start captions."); return }
                do {
                    try self.mic.start { [weak self] data in DispatchQueue.main.async { self?.sendAudio(data, run: run) } }
                    self.onEvent?(readyEvent)
                } catch { self.fail(error.localizedDescription) }
            }
        }
    }
    func sendAudio(_ data: Data, run: Int) {
        guard run == generation, !stopping, let socket else { return }
        guard pendingBytes + data.count <= 128000 else { fail("Network is behind. Capture stopped; reconnect to continue."); return }
        pendingBytes += data.count
        socket.send(.data(data)) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, self.generation == run else { return }
                self.pendingBytes -= data.count
                if error != nil { self.fail("Audio upload failed. Reconnect to continue.") }
            }
        }
    }
    func stop() {
        guard !stopping else { return }
        stopping = true; mic.stop(deactivateSession: false); screenAudio.stop()
        guard socket != nil else {
            onEvent?("{\"type\":\"finished\",\"reason\":\"Native session stopped\"}")
            dispose()
            return
        }
        socket?.send(.string("{\"type\":\"stop\"}")) { _ in }
        let run = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.generation == run else { return }
            self.fail("Finalization timed out; some translated captions may be incomplete.")
        }
    }
    func fail(_ message: String) {
        translatedPlayback.stop()
        if let data = try? JSONSerialization.data(withJSONObject: ["type": "error", "message": message]), let text = String(data: data, encoding: .utf8) { onEvent?(text) }
        onEvent?("{\"type\":\"finished\",\"reason\":\"Native session stopped\"}")
        dispose()
    }
    func dispose() {
        generation += 1; stopping = true; mic.stop(deactivateSession: false); screenAudio.stop(); pip.stop(); translatedPlayback.finishSession()
        observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = []
        socket?.cancel(with: .normalClosure, reason: nil); socket = nil; pendingBytes = 0
    }
}
private var nativeSession: NativeCaptionSession?
public typealias NativeEventCallback = @convention(c) (UnsafePointer<CChar>) -> Void
@_cdecl("audeeo_native_session_start")
public func nativeSessionStart(_ endpoint: UnsafePointer<CChar>, _ token: UnsafePointer<CChar>, _ source: UnsafePointer<CChar>, _ target: UnsafePointer<CChar>, _ owner: UnsafePointer<CChar>, _ save: Bool, _ silenceTimeout: Int32, _ silenceThreshold: Int32, _ provider: UnsafePointer<CChar>, _ providerKey: UnsafePointer<CChar>, _ context: UnsafePointer<CChar>, _ input: UnsafePointer<CChar>, _ callback: @escaping NativeEventCallback) {
    let endpoint = String(cString: endpoint), token = String(cString: token), source = String(cString: source), target = String(cString: target)
    let owner = String(cString: owner), provider = String(cString: provider), providerKey = String(cString: providerKey), context = String(cString: context), input = String(cString: input)
    DispatchQueue.main.async {
        nativeSession?.dispose()
        guard let url = URL(string: endpoint), ["https", "http"].contains(url.scheme ?? "") else { return }
        let session = NativeCaptionSession(); nativeSession = session
        session.onEvent = { text in text.withCString { callback($0) } }
        if save {
            do { session.history = try NativeHistory(owner: owner) }
            catch { session.fail("History storage is unavailable. Retry or choose don’t save."); return }
        }
        session.pip.onError = { [weak session] message in session?.fail(message) }
        session.start(endpoint: url, token: token, source: source, target: target, silenceTimeout: silenceTimeout, silenceThreshold: silenceThreshold, provider: provider, providerKey: providerKey, context: context, input: input)
    }
}
@_cdecl("audeeo_native_session_stop")
public func nativeSessionStop() { DispatchQueue.main.async { nativeSession?.stop() } }
@_cdecl("audeeo_pip_start")
public func pipStart() { DispatchQueue.main.async { do { try nativeSession?.pip.start() } catch { nativeSession?.fail(error.localizedDescription) } } }
@_cdecl("audeeo_pip_caption_size")
public func pipCaptionSize(_ size: Double) { DispatchQueue.main.async { nativeSession?.pip.captionSize = size } }
@_cdecl("audeeo_pip_stop")
public func pipStop() { DispatchQueue.main.async { nativeSession?.pip.stop() } }
#endif
