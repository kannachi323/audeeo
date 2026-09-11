import Foundation

/// Owner-scoped finalized text survives WebView suspension. No raw audio is written.
private let historyLock = NSRecursiveLock()
final class NativeHistory {
    let owner: String
    let url: URL
    init(owner: String) throws {
        guard UUID(uuidString: owner) != nil else { throw NSError(domain: "Audeeo", code: 10) }
        self.owner = owner
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("AudeeoNativeHistory", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("\(owner).json")
    }
    func read() throws -> [[String: Any]] {
        historyLock.lock(); defer { historyLock.unlock() }
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]] ?? []
    }
    func write(_ entries: [[String: Any]]) throws {
        historyLock.lock(); defer { historyLock.unlock() }
        let data = try JSONSerialization.data(withJSONObject: entries)
        guard data.count <= 2_000_000, entries.count <= 1000 else { throw NSError(domain: "Audeeo", code: 11, userInfo: [NSLocalizedDescriptionKey: "Offline history is full. Open Audeeo to sync before continuing."]) }
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    func enqueue(_ segment: [String: Any]) throws {
        historyLock.lock(); defer { historyLock.unlock() }
        guard segment["final"] as? Bool == true, let id = segment["id"] as? String else { return }
        var entries = try read()
        entries.removeAll { $0["id"] as? String == id }
        entries.append(segment)
        try write(entries)
    }
    func acknowledge(_ snapshots: [[String: Any]]) throws {
        historyLock.lock(); defer { historyLock.unlock() }
        let remaining = try read().filter { entry in
            !snapshots.contains { snapshot in
                entry["id"] as? String == snapshot["id"] as? String && entry["revision"] as? Int == snapshot["revision"] as? Int && entry["state"] as? String == snapshot["state"] as? String
            }
        }
        try write(remaining)
    }
}
@_cdecl("audeeo_history_get")
public func historyGet(_ owner: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    do {
        let entries = try NativeHistory(owner: String(cString: owner)).read()
        let data = try JSONSerialization.data(withJSONObject: entries)
        return strdup(String(data: data, encoding: .utf8) ?? "[]")
    } catch { return nil }
}
@_cdecl("audeeo_history_ack")
public func historyAck(_ owner: UnsafePointer<CChar>, _ raw: UnsafePointer<CChar>) -> Int32 {
    do {
        let snapshots = try JSONSerialization.jsonObject(with: Data(String(cString: raw).utf8)) as? [[String: Any]] ?? []
        try NativeHistory(owner: String(cString: owner)).acknowledge(snapshots)
        return 0
    } catch { return 1 }
}
@_cdecl("audeeo_history_delete")
public func historyDelete(_ owner: UnsafePointer<CChar>) -> Int32 {
    historyLock.lock(); defer { historyLock.unlock() }
    do {
        let history = try NativeHistory(owner: String(cString: owner))
        if FileManager.default.fileExists(atPath: history.url.path) { try FileManager.default.removeItem(at: history.url) }
        return 0
    } catch { return 1 }
}
