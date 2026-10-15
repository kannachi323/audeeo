import Foundation

/// Rust context, PCM16 samples, sample count, status. Status 0 carries audio;
/// status 2 means the device failed and the capture has stopped.
public typealias AudeeoPCMCallback = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<Int16>?, Int, Int32) -> Void

/// Start results shared with Rust.
enum AudeeoStatus: Int32 {
    case ok = 0, denied = 1, device = 2, unsupported = 3, noSuchProcess = 4
}

protocol AudeeoCapture: AnyObject {
    func stop()
}

/// Delivers PCM to Rust until stopped. Stop is synchronous: once it returns,
/// the callback never runs again, so Rust can free its context.
final class AudeeoDelivery {
    private let lock = NSLock()
    private var open = true
    private let context: UnsafeMutableRawPointer?
    private let callback: AudeeoPCMCallback

    init(context: UnsafeMutableRawPointer?, callback: @escaping AudeeoPCMCallback) {
        self.context = context
        self.callback = callback
    }

    func send(_ samples: UnsafePointer<Int16>, count: Int) {
        lock.lock(); defer { lock.unlock() }
        if open { callback(context, samples, count, AudeeoStatus.ok.rawValue) }
    }

    func fail() {
        lock.lock(); defer { lock.unlock() }
        if open { callback(context, nil, 0, AudeeoStatus.device.rawValue); open = false }
    }

    func close() {
        lock.lock(); open = false; lock.unlock()
    }
}

func retain(_ capture: AudeeoCapture) -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(capture as AnyObject).toOpaque()
}

@_cdecl("audeeo_core_capture_stop")
public func audeeoCoreCaptureStop(_ handle: UnsafeMutableRawPointer?) {
    guard let handle else { return }
    let object = Unmanaged<AnyObject>.fromOpaque(handle).takeRetainedValue()
    (object as? AudeeoCapture)?.stop()
}

@_cdecl("audeeo_core_string_free")
public func audeeoCoreStringFree(_ value: UnsafeMutablePointer<CChar>?) {
    free(value)
}

@_cdecl("audeeo_core_system_supported")
public func audeeoCoreSystemSupported() -> Bool {
    if #available(macOS 14.2, *) { return true }
    return false
}
