#if os(macOS)
import AppKit
import CoreAudio

private func sourceNumber(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: UInt32 = 0, size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
    return value
}
private func sourceName(_ object: AudioObjectID) -> String? {
    var address = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
    return value?.takeRetainedValue() as String?
}

// Read-only metadata. No audio, browser history, or private Now Playing APIs.
@_cdecl("audeeo_capture_sources")
public func captureSources() -> UnsafeMutablePointer<CChar>? {
    let system = AudioObjectID(kAudioObjectSystemObject)
    let microphone = sourceNumber(system, kAudioHardwarePropertyDefaultInputDevice).flatMap(sourceName) ?? "Microphone"
    var applicationObjects: [String: Set<AudioObjectID>] = [:]
    if #available(macOS 14.2, *) {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        if AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 {
            var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
            let result = objects.withUnsafeMutableBytes { AudioObjectGetPropertyData(system, &address, 0, nil, &size, $0.baseAddress!) }
            if result == noErr {
                for object in objects {
                    guard sourceNumber(object, kAudioProcessPropertyIsRunningOutput) == 1,
                          let pid = sourceNumber(object, kAudioProcessPropertyPID), pid != UInt32(getpid()),
                          let app = NSRunningApplication(processIdentifier: pid_t(bitPattern: pid)),
                          let name = app.localizedName, !name.isEmpty else { continue }
                    applicationObjects[name, default: []].insert(object)
                }
            }
        }
    }
    let captureSources: [[String: String]] = applicationObjects.map { name, objects in
        ["id": "macos:" + objects.sorted().map(String.init).joined(separator: ","), "name": name]
    }.sorted { $0["name", default: ""] < $1["name", default: ""] }
    let result: [String: Any] = [
        "microphone": microphone,
        "applications": captureSources.compactMap { $0["name"] },
        "captureSources": captureSources,
    ]
    guard let json = try? JSONSerialization.data(withJSONObject: result), let string = String(data: json, encoding: .utf8) else { return nil }
    return strdup(string)
}
#endif
