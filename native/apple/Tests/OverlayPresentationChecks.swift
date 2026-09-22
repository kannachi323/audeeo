import AppKit
@main struct OverlayPresentationChecks {
    static func main() {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 260), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let raw = Unmanaged.passUnretained(window).toOpaque()
        let content = window.contentView
        windowMode(raw, false, false)
        assert(window.level == .normal && window.styleMask.contains(.titled))
        assert(window.isOpaque)
        windowMode(raw, true, true)
        assert(window.level == .floating && window.collectionBehavior.contains(.fullScreenAuxiliary))
        assert(window.styleMask.contains(.borderless) && !window.styleMask.contains(.titled))
        assert(!window.isOpaque && window.backgroundColor == .clear, "Native overlay must have a clear window backing")
        assert(window.contentView === content, "Mode changes must retain the session WebView")
        assert(content?.subviews.filter { $0.identifier?.rawValue == "audeeo-overlay-grip" }.count == 1)
        windowMode(raw, true, false)
        assert(content?.subviews.filter { $0.identifier?.rawValue == "audeeo-overlay-grip" }.count == 1)
        windowMode(raw, false, false)
        assert(window.level == .normal && window.styleMask.contains(.titled))
        assert(window.isOpaque && window.contentView === content)
        assert(content?.subviews.contains { $0.identifier?.rawValue == "audeeo-overlay-grip" } == false)
        assert(content?.layer?.masksToBounds != true)
        window.close()
        print("Public AppKit overlay checks passed: transparent native surface, floating mode, settings restoration, single persistent WebView.")
    }
}
