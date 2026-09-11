#if os(macOS)
import AppKit
import AVFoundation
import CoreAudio

@available(macOS 14.2, *)
final class SystemAudioRoute {
    private var tap: AudioObjectID = 0
    private var device: AudioObjectID = 0
    private var io: AudioDeviceIOProcID?
    private let playback = TranslationPlayback()
    private var deviceListener: AudioObjectPropertyListenerBlock?
    private var generation = 0
    private let slots = DispatchSemaphore(value: 8)
    private let failureLock = NSLock()
    private var failureQueued = false
    var volume: Float = 1 { didSet { playback.volume = volume } }
    private var outputAddress = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    func start(_ callback: @escaping AudioCallback) throws {
        stop()
        playback.reset()
        playback.maximumSeconds = 1
        failureLock.lock(); failureQueued = false; failureLock.unlock()
        let run = generation
        func check(_ code: OSStatus) throws {
            if code != noErr { throw NSError(domain: "CoreAudio", code: Int(code)) }
        }
        do {
            var pid = getpid(), own: AudioObjectID = 0
            var size = UInt32(MemoryLayout<AudioObjectID>.size)
            var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &own))
            guard own != 0 else { throw NSError(domain: "Audeeo", code: 30) }
            // All playback is native in this process. No WebView audio output enters the mix.
            let description = CATapDescription(monoGlobalTapButExcludeProcesses: [own])
            description.name = "Audeeo source audio"
            description.isPrivate = true
            description.muteBehavior = .mutedWhenTapped
            try check(AudioHardwareCreateProcessTap(description, &tap))
            var asbd = AudioStreamBasicDescription()
            size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            address.mSelector = kAudioTapPropertyFormat
            try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &asbd))
            guard let format = AVAudioFormat(streamDescription: &asbd),
                  let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true),
                  let converter = AVAudioConverter(from: format, to: output) else { throw NSError(domain: "Audeeo", code: 31) }
            let aggregate: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Audeeo private capture",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceTapAutoStartKey: true,
                kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]]
            ]
            try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device))
            playback.onError = { [weak self] _ in self?.stop(); callback(nil, 0, 2) }
            let queue = DispatchQueue(label: "com.mattdev727.audeeo.source-audio")
            try check(AudioDeviceCreateIOProcIDWithBlock(&io, device, queue) { [weak self] _, input, _, _, _ in
                guard let self else { return }
                guard self.slots.wait(timeout: .now()) == .success else {
                    self.failureLock.lock()
                    let report = !self.failureQueued
                    self.failureQueued = true
                    self.failureLock.unlock()
                    if report { DispatchQueue.main.async { if self.generation == run { self.stop(); callback(nil, 0, 2) } } }
                    return
                }
                defer { self.slots.signal() }
                let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
                guard let first = list.first, first.mData != nil, asbd.mBytesPerFrame > 0 else { return }
                let frames = first.mDataByteSize / asbd.mBytesPerFrame
                guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: input),
                      let pcm = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(ceil(Double(frames) * 24000 / format.sampleRate) + 32)) else { return }
                buffer.frameLength = frames
                var supplied = false, error: NSError?
                converter.convert(to: pcm, error: &error) { _, status in
                    if supplied { status.pointee = .noDataNow; return nil }
                    supplied = true; status.pointee = .haveData; return buffer
                }
                guard error == nil, let samples = pcm.int16ChannelData?[0], pcm.frameLength > 0 else { return }
                let data = Data(bytes: samples, count: Int(pcm.frameLength) * 2)
                // Reserve before queuing so a stalled main thread cannot accumulate audio indefinitely.
                guard self.slots.wait(timeout: .now()) == .success else { return }
                DispatchQueue.main.async {
                    defer { self.slots.signal() }
                    guard self.generation == run else { return }
                    do {
                        try self.playback.enqueue(pcm: data)
                        data.withUnsafeBytes { callback($0.bindMemory(to: UInt8.self).baseAddress, data.count, 0) }
                    } catch { self.stop(); callback(nil, 0, 2) }
                }
            })
            let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
                guard let self, self.generation == run else { return }
                self.stop(); callback(nil, 0, 2)
            }
            deviceListener = listener
            try check(AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &outputAddress, .main, listener))
            try check(AudioDeviceStart(device, io))
            callback(nil, 0, 0)
        } catch { stop(); throw error }
    }
    func stop() {
        generation += 1
        if let listener = deviceListener {
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &outputAddress, .main, listener)
            deviceListener = nil
        }
        // Release the reader first: mutedWhenTapped restores normal source output immediately.
        if let io { AudioDeviceStop(device, io); AudioDeviceDestroyIOProcID(device, io) }
        io = nil
        if device != 0 { AudioHardwareDestroyAggregateDevice(device); device = 0 }
        if tap != 0 { AudioHardwareDestroyProcessTap(tap); tap = 0 }
        playback.stop()
    }
    deinit { stop() }
}
private var systemRoute: AnyObject?
@_cdecl("audeeo_system_start")
public func systemStart(_ callback: @escaping AudioCallback) {
    DispatchQueue.main.async {
        guard #available(macOS 14.2, *) else { callback(nil, 0, 3); return }
        if systemRoute == nil { systemRoute = SystemAudioRoute() }
        do { try (systemRoute as? SystemAudioRoute)?.start(callback) }
        catch { callback(nil, 0, 1) }
    }
}
@_cdecl("audeeo_system_stop")
public func systemStop() { DispatchQueue.main.async { if #available(macOS 14.2, *) { (systemRoute as? SystemAudioRoute)?.stop() } } }
@_cdecl("audeeo_source_volume")
public func sourceVolume(_ volume: Double) {
    DispatchQueue.main.async {
        if #available(macOS 14.2, *) {
            if systemRoute == nil { systemRoute = SystemAudioRoute() }
            (systemRoute as? SystemAudioRoute)?.volume = Float(min(1, max(0, volume)))
        }
    }
}
#endif
