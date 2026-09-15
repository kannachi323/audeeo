// Isolated AppKit regression checks; the window is never shown.
import AppKit
import WebKit

@main struct NativeWindowModeChecks {
    static func main() {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 720, height: 320),
                              styleMask: [.titled, .resizable, .closable, .miniaturizable],
                              backing: .buffered, defer: false)
        let host = NSView(frame: window.contentView!.bounds)
        let web = WKWebView(frame: host.bounds)
        web.autoresizingMask = [.width, .height]
        host.addSubview(web)
        window.contentView = host
        let raw = Unmanaged.passUnretained(window).toOpaque()
        let originalFrame = window.frame
        for _ in 0..<3 {
            windowMode(raw, false, false)
            precondition(window.styleMask.contains(.titled))
            precondition(!window.styleMask.contains(.fullSizeContentView))
            precondition(window.isOpaque && window.hasShadow && window.level == .normal)
            precondition(window.collectionBehavior.contains(.fullScreenPrimary))
            for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
                precondition(window.standardWindowButton(button)?.isHidden == false)
            }
            precondition(!host.subviews.contains { $0 is PanelDragRegion })
            windowMode(raw, true, true)
            precondition(!window.styleMask.contains(.titled))
            precondition(window.styleMask.contains(.resizable))
            precondition(!window.isOpaque && !window.hasShadow && window.level == .floating)
            precondition(window.backgroundColor == .clear)
            precondition(host.subviews.filter { $0 is PanelDragRegion }.count == 1)
            precondition(window.contentView === host && web.superview === host)
            precondition(NSEqualRects(window.frame, originalFrame))
        }
        windowMode(raw, false, false)
        precondition(!host.subviews.contains { $0 is PanelDragRegion })
        print("PASS: native controls, borderless overlay, normal-window restoration, stable frame and WebView host")
    }
}
