import AppKit
import WebKit
final class OverlayStreamProbe: NSObject, WKScriptMessageHandler {
    var updates = 0
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { updates += 1 }
}
@main struct OverlayStreamingChecks {
    static func main() {
        _ = NSApplication.shared
        let probe = OverlayStreamProbe()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(probe, name: "caption")
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 320), styleMask: [.titled], backing: .buffered, defer: false)
        let web = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        window.contentView!.addSubview(web)
        windowMode(Unmanaged.passUnretained(window).toOpaque(), true, true)
        assert(web.isHidden)
        web.loadHTMLString("<script>setInterval(()=>window.webkit.messageHandlers.caption.postMessage('partial'),50)</script>", baseURL:nil)
        let deadline = Date().addingTimeInterval(4)
        while probe.updates < 10 && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        assert(probe.updates >= 10, "The hidden session WebView must continue delivering streamed updates")
        configuration.userContentController.removeScriptMessageHandler(forName: "caption")
        print("PASS: hidden session WebView continues delivering caption updates")
    }
}
