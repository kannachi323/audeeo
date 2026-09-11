import AppKit
import WebKit
@main struct ControlsPopoverChecks {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let panel = NSWindow(contentRect: NSRect(x: 100, y: 500, width: 400, height: 260), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        windowMode(Unmanaged.passUnretained(panel).toOpaque(), false, false)
        panel.makeKeyAndOrderFront(nil)
        let host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 310, height: 300), styleMask: .borderless, backing: .buffered, defer: false)
        host.isReleasedWhenClosed = false
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 310, height: 300))
        let nativeRoot = host.contentView!
        nativeRoot.addSubview(web)
        web.loadHTMLString("<html><body style='background:#232323;color:white'>Audio controls</body></html>", baseURL: nil)
        let frame = panel.frame
        let controls = ControlsPopover.shared
        for height in [120.0, 300.0, 240.0] {
            controls.show(main: panel, host: host, anchor: NSRect(x: 30, y: 205, width: 36, height: 36), height: height)
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
            assert(controls.popover.isShown)
            assert(!host.isVisible, "The backing window must never become a second screen")
            assert(panel.childWindows?.contains(host) != true)
            assert(panel.frame == frame, "Opening controls must not resize or move captions")
            assert(host.contentView === nativeRoot, "Tao must retain its original non-null root view")
            assert(controls.popover.contentViewController?.view.subviews.contains(web) == true, "Reuse the original webview")
            // Exercise the root access Tao performs after AppKit focus/resize events.
            host.setFrame(host.frame.insetBy(dx: -1, dy: 0), display: false)
            assert(host.contentView === nativeRoot)
            let popupWindow = web.window
            controls.show(main: panel, host: host, anchor: NSRect(x: 30, y: 205, width: 36, height: 36), height: 420)
            assert(controls.popover.isShown && web.window === popupWindow, "Growing a select must retain the open popover")
            assert(controls.popover.contentSize.height >= height, "An open menu receives more vertical room")
            assert(panel.frame == frame && host.contentView === nativeRoot)
            controls.show(main: panel, host: host, anchor: NSRect(x: 30, y: 205, width: 36, height: 36), height: height)
            assert(controls.popover.contentSize.height == height, "Closing the select restores the compact height")
            closeControlsPopover()
            assert(!controls.popover.isShown)
            assert(host.contentView === nativeRoot, "Closing must preserve the Tao root too")
        }
        host.close(); panel.close()
        print("Native popover checks passed: hidden host, reusable webview, unchanged caption frame, close/reopen.")
    }
}
