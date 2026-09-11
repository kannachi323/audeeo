import AppKit
@main struct OverlayPresentationChecks {
    static func main() {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 260), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let raw = Unmanaged.passUnretained(window).toOpaque()
        windowMode(raw, false, false)
        assert(window.level == .normal && window.titleVisibility == .hidden)
        let content = window.contentView
        windowMode(raw, true, true)
        assert(window.level == .floating && window.collectionBehavior.contains(.fullScreenAuxiliary))
        assert(window.titleVisibility == .hidden)
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency { assert(!window.isOpaque && window.backgroundColor == .clear) }
        windowMode(raw, true, false) // Settings while session remains active.
        assert(window.level == .floating && !window.isOpaque)
        assert(window.contentView === content, "Navigation must not replace the window or its session-owning WebView")
        windowMode(raw, false, false)
        assert(window.level == .normal && window.titleVisibility == .hidden)
        assert(window.contentView === content)
        assert(window.contentView?.subviews.filter { $0.identifier?.rawValue == "audeeo-overlay-grip" }.count == 1)
        assert(window.contentView?.subviews.first { $0.identifier?.rawValue == "audeeo-overlay-grip" }?.isHidden == false)
        assert(content?.layer?.masksToBounds != true, "Native edge hit targets must not be clipped")
        let grip = content!.subviews.first { $0.identifier?.rawValue == "audeeo-overlay-grip" } as! PanelDragRegion
        assert(abs(grip.frame.midX - content!.bounds.midX) < 1)
        assert(abs(grip.frame.maxY - (content!.bounds.maxY + 6)) < 1)
        assert(abs(grip.frame.midY - (content!.bounds.maxY - 6)) < 1, "Pill must straddle the CSS panel top border")
        assert(grip.subviews.first?.frame.size == NSSize(width: 24, height: 12), "Visible pill must be half-sized")
        assert(window.hasShadow == false, "No outer rectangular window shadow")
        assert(!grip.gripVisible)
        grip.setHovered(true)
        assert(grip.hovered && grip.gripVisible)
        RunLoop.main.run(until: Date().addingTimeInterval(2.2))
        assert(!grip.gripVisible, "The grip must fade after mouse inactivity")
        grip.noteActivity()
        assert(grip.gripVisible, "Mouse movement restores the grip")
        window.close()
        print("Single-window AppKit mode checks passed: normal, overlay, Settings during playback, restoration, content identity.")
    }
}
