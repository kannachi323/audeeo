import AppKit
import WebKit

final class OverlayFixtureWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
final class OverlayFixtureDelegate: NSObject, NSApplicationDelegate {
    var backdrop: NSWindow!, panel: NSWindow!
    var style: [String: Any] = ["backgroundColor":"#191919", "backgroundOpacity":0.0, "borderWidth":0.0, "borderOpacity":0.0, "borderRadius":20, "fontSize":32, "controlsOpacity":1.0, "overlayOpacity":1.0]
    func applicationDidFinishLaunching(_ notification: Notification) {
        backdrop = NSWindow(contentRect: NSRect(x: 120, y: 220, width: 920, height: 560), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        backdrop.title = "Overlay appearance verification — synthetic captions"
        let view = NSView(frame: backdrop.contentView!.bounds); view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(srgbRed: 0.15, green: 0.4, blue: 0.6, alpha: 1).cgColor
        for i in 0..<10 {
            let stripe = NSView(frame: NSRect(x: i*92, y: 0, width: 46, height: 560)); stripe.wantsLayer = true
            stripe.layer?.backgroundColor = NSColor(srgbRed: 0.16, green: 0.55, blue: 0.4, alpha: 1).cgColor; view.addSubview(stripe)
        }
        for (i, title) in ["Transparent", "25% background", "Solid", "Settings", "Overlay"].enumerated() {
            let button = NSButton(title: title, target: self, action: #selector(change(_:)))
            button.frame = NSRect(x: 30+i*170, y: 35, width: 160, height: 32); view.addSubview(button)
        }
        backdrop.contentView = view; backdrop.makeKeyAndOrderFront(nil)
        panel = OverlayFixtureWindow(contentRect: NSRect(x: 220, y: 410, width: 720, height: 300), styleMask: [.titled, .resizable, .closable], backing: .buffered, defer: false)
        panel.title = "Audeeo overlay test"
        let web = WKWebView(frame: panel.contentView!.bounds); panel.contentView!.addSubview(web)
        web.loadHTMLString("<body style='background:#191919;color:white;font:24px system-ui;padding:30px'>Settings surface restored</body>", baseURL:nil)
        windowMode(Unmanaged.passUnretained(panel).toOpaque(), true, true)
        update(); panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func update() {
        captionOverlay(panel)?.update(["source":"透明字幕，跟随你的设置。", "translation":"Your overlay follows your settings.", "preferences":["appearance":style, "showSource":true, "autoHide":false, "status":"live", "direction":"Appearance check · synthetic text"]])
    }
    @objc func change(_ sender: NSButton) {
        switch sender.title {
        case "Transparent": style["backgroundOpacity"] = 0.0
        case "25% background": style["backgroundOpacity"] = 0.25
        case "Solid": style["backgroundOpacity"] = 1.0
        case "Settings": windowMode(Unmanaged.passUnretained(panel).toOpaque(), false, false); return
        case "Overlay": windowMode(Unmanaged.passUnretained(panel).toOpaque(), true, true)
        default: break
        }
        update()
    }
}
@main struct OverlayVisualFixture {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let menu = NSMenu(); let item = NSMenuItem(); let submenu = NSMenu()
        submenu.addItem(withTitle: "Quit Overlay Check", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = submenu; menu.addItem(item); app.mainMenu = menu
        let delegate = OverlayFixtureDelegate(); app.delegate = delegate
        app.run()
    }
}
