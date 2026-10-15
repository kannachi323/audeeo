import AppKit
import CoreAudio
import Foundation

private func number(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
    return value
}

private func name(_ object: AudioObjectID) -> String? {
    var address = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
    return value?.takeRetainedValue() as String?
}

/// Read-only metadata: the default microphone's name and the apps currently
/// playing audio, as JSON `{microphone, applications: [{name, pids}]}`.
/// No audio is opened.
@_cdecl("audeeo_core_capture_sources")
public func audeeoCoreCaptureSources() -> UnsafeMutablePointer<CChar>? {
    let system = AudioObjectID(kAudioObjectSystemObject)
    let microphone = number(system, kAudioHardwarePropertyDefaultInputDevice).flatMap(name) ?? "Microphone"
    var apps: [String: Set<UInt32>] = [:]
    if #available(macOS 14.2, *) {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        if AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 {
            var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
            let result = objects.withUnsafeMutableBytes { AudioObjectGetPropertyData(system, &address, 0, nil, &size, $0.baseAddress!) }
            if result == noErr {
                for object in objects {
                    guard number(object, kAudioProcessPropertyIsRunningOutput) == 1,
                          let pid = number(object, kAudioProcessPropertyPID), pid != UInt32(getpid()),
                          let app = NSRunningApplication(processIdentifier: pid_t(bitPattern: pid)),
                          let appName = app.localizedName, !appName.isEmpty else { continue }
                    apps[appName, default: []].insert(pid)
                }
            }
        }
    }
    let applications: [[String: Any]] = apps.keys.sorted().map { ["name": $0, "pids": apps[$0]!.sorted()] }
    let result: [String: Any] = ["microphone": microphone, "applications": applications]
    guard let json = try? JSONSerialization.data(withJSONObject: result),
          let string = String(data: json, encoding: .utf8) else { return nil }
    return strdup(string)
}
