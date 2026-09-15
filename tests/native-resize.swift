// Isolated AppKit regression checks. The test window is never shown.
import AppKit
import WebKit

final class ResizeTestWindow: NSWindow {
    var updates: [(NSRect, Bool, Bool)] = []
    override func setFrame(_ frameRect: NSRect, display flag: Bool, animate: Bool) {
        updates.append((frameRect, flag, animate))
        super.setFrame(frameRect, display: flag, animate: animate)
    }
}
final class ResizeTestWebView: WKWebView {
    var starts = 0, ends = 0
    override func viewWillStartLiveResize() { starts += 1; super.viewWillStartLiveResize() }
    override func viewDidEndLiveResize() { ends += 1; super.viewDidEndLiveResize() }
}
@main struct NativeResizeChecks {
    static func main() {
        _ = NSApplication.shared
        let original = NSRect(x: 300, y: 300, width: 500, height: 260)
        let screen = NSRect(x: 0, y: 0, width: 1600, height: 1000)
        let minimum = NSSize(width: 480, height: 260)
        let window = ResizeTestWindow(contentRect: original, styleMask: [.borderless], backing: .buffered, defer: false)
        let host = NSView(frame: NSRect(origin: .zero, size: original.size))
        window.contentView = host
        let web = ResizeTestWebView(frame: host.bounds)
        web.autoresizingMask = [.width, .height]
        host.addSubview(web)
        let region = PanelResizeRegion(frame: host.bounds)
        region.autoresizingMask = [.width, .height]
        host.addSubview(region)
        window.updates.removeAll()
        region.beginResizeRendering()
        precondition(web.starts == 1)
        for delta in [-10.0, -40, -100] {
            region.queueResizeFrame(PanelResizeRegion.resized(original, delta: NSPoint(x: delta, y: 0), edges: (-1, 0), minimum: minimum, screen: screen))
        }
        precondition(window.updates.isEmpty, "Mouse events must coalesce before rendering")
        region.flushResizeFrame()
        precondition(window.updates.count == 1)
        precondition(window.frame.maxX == original.maxX, "The right edge must stay pinned")
        precondition(window.frame.width == 600)
        precondition(web.frame.size == host.bounds.size, "WebView host must match the new geometry")
        precondition(!window.updates[0].1 && !window.updates[0].2, "Do not force an early display or animate geometry")
        region.queueResizeFrame(PanelResizeRegion.resized(original, delta: NSPoint(x: 999, y: 0), edges: (-1, 0), minimum: minimum, screen: screen))
        region.endResizeRendering()
        precondition(window.frame.width == 480 && window.frame.maxX == original.maxX)
        precondition(window.updates.count == 2, "Release must flush the final frame")
        precondition(web.ends == 1)
        region.flushResizeFrame()
        precondition(window.updates.count == 2)
        region.beginResizeRendering()
        region.removeFromSuperview()
        precondition(web.starts == 2 && web.ends == 2, "Detaching must close the resize lifecycle")
        print("PASS: coalesced resize, pinned right edge, minimum width, matching WebView size, final-frame flush, lifecycle cleanup")
    }
}
