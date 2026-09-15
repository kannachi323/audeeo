import AppKit

// Local automated AppKit checks; these do not simulate mouse input or physical-device capture.
@main
struct WindowGeometryChecks {
    static func main() {
        _ = NSApplication.shared
        guard let visible = NSScreen.main?.visibleFrame else { fatalError("A Mac display is required") }
        let window = NSWindow(contentRect: NSRect(x: visible.minX + 100, y: visible.minY + 200, width: 600, height: 224),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let raw = Unmanaged.passUnretained(window).toOpaque()
        // The same borderless panel and grip remain throughout navigation.
        windowMode(raw, false, false)
        resizeMainWindow(raw, 224)
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        window.setFrameTopLeftPoint(NSPoint(x: visible.minX + 80, y: visible.maxY - 60))
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        let original = window.frame
        resizeMainWindow(raw, 440)
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        assert(abs(window.frame.maxY - original.maxY) < 1, "Expansion must preserve the top edge")
        assert(abs(window.frame.width - original.width) < 1, "Expansion must preserve user width")
        resizeMainWindow(raw, 224)
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        assert(abs(window.frame.maxY - original.maxY) < 1, "Collapse must preserve placement")
        assert(window.isMovable, "Native window must remain movable")
        assert(window.styleMask.contains(.fullSizeContentView) && window.titleVisibility == .hidden, "Native titlebar must remain visually hidden")
        assert(window.contentView?.subviews.filter { $0.identifier?.rawValue == "audeeo-overlay-grip" }.count == 1, "Repeated resize must not duplicate grips")
        let grip = window.contentView?.subviews.first { $0.identifier?.rawValue == "audeeo-overlay-grip" }
        assert((window.contentView?.bounds.maxY ?? 0) - (grip?.frame.maxY ?? 0) >= 6, "Move grip must leave the top resize border clear")
        let before = window.frame.origin
        nudgeMainWindow(raw, 10, 10)
        assert(abs(window.frame.minX - before.x - 10) < 1, "Keyboard movement must move horizontally")
        assert(abs(window.frame.minY - before.y + 10) < 1, "Down must move toward screen bottom")
        window.setFrameOrigin(NSPoint(x: visible.maxX - 100, y: visible.minY - 100))
        resizeMainWindow(raw, 440)
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        assert(visible.insetBy(dx: -1, dy: -1).contains(window.frame), "Expansion must clamp to usable screen")
        print("AppKit geometry checks passed: top-edge preservation, width, collapse, movable window, single grip, keyboard movement and screen bounds.")
        windowMode(raw, false, false)
        assert(window.styleMask.contains(.resizable))
        assert(window.styleMask.contains(.fullSizeContentView))
        assert(window.standardWindowButton(.closeButton)?.isHidden == true)
        let fixedRight=window.frame.maxX
        for step in 0..<100 {
            let width=CGFloat(400+step)
            window.setFrame(NSRect(x:fixedRight-width,y:window.frame.minY,width:width,height:window.frame.height),display:true,animate:false)
            assert(abs(window.frame.maxX-fixedRight)<0.01)
        }
        window.close()
    }
}
