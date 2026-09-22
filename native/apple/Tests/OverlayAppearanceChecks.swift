import AppKit
import WebKit

@main struct OverlayAppearanceChecks {
    static func main() {
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 720, height: 320), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        let host = NSView(frame: window.contentView!.bounds)
        let web = WKWebView(frame: host.bounds)
        host.addSubview(web); window.contentView = host
        let raw = Unmanaged.passUnretained(window).toOpaque()
        windowMode(raw, true, true)
        let surface = captionOverlay(window)!
        var style: [String: Any] = ["backgroundColor":"#1256ab", "backgroundOpacity":0.0, "borderColor":"#ff0000", "borderOpacity":0.5, "borderWidth":3.0, "borderRadius":12.0, "overlayOpacity":0.7, "textOpacity":0.6, "textColor":"#00ff00", "sourceTextColor":"#0000ff", "fontFamily":"mono", "fontSize":32, "fontWeight":600, "controlsOpacity":0.4]
        func update(opaque: Bool = false, showSource: Bool = true, autoHide: Bool = false) {
            surface.update(["source":"Original speech", "translation":"Translated speech", "opaque":opaque, "preferences":["appearance":style, "showSource":showSource, "autoHide":autoHide, "status":"live"]])
            surface.layoutSubtreeIfNeeded()
        }
        update()
        assert(!window.isOpaque && window.backgroundColor == .clear && !window.hasShadow)
        assert(web.isHidden && !surface.isHidden && web.superview === host)
        assert(surface.layer!.backgroundColor!.alpha == 0)
        assert(abs(surface.alphaValue - 0.7) < 0.001)
        assert(abs(host.subviews.compactMap { $0 as? PanelDragRegion }.first!.alphaValue - 0.28) < 0.001)
        assert(surface.layer!.borderWidth == 3 && surface.layer!.cornerRadius == 12)
        assert(abs(surface.layer!.borderColor!.alpha - 0.5) < 0.001)
        let labels = surface.subviews.compactMap { $0 as? NSTextField }
        assert(labels[0].stringValue == "Original speech" && labels[1].stringValue == "Translated speech")
        assert(labels[1].font!.pointSize == 32 && labels[1].font!.isFixedPitch)
        assert(abs(labels[1].alphaValue - 0.6) < 0.001)
        update(opaque:true)
        assert(surface.layer!.backgroundColor!.alpha == 1 && surface.alphaValue == 1)
        assert(abs(NSColor(cgColor:surface.layer!.backgroundColor!)!.usingColorSpace(.sRGB)!.blueComponent - 171.0/255) < 0.001)
        style["backgroundOpacity"] = 0.25
        update(showSource:false, autoHide:true)
        assert(abs(surface.layer!.backgroundColor!.alpha - 0.25) < 0.001)
        assert(labels[0].isHidden && labels[2].isHidden)
        surface.update(["source":"Newest partial", "translation":"Newest translation", "preferences":["appearance":style, "showSource":true, "autoHide":false, "controlsOpen":true, "status":"connecting"]])
        surface.layoutSubtreeIfNeeded()
        assert(labels[0].stringValue == "Newest partial")
        let buttons = surface.subviews.flatMap { $0.subviews }.compactMap { $0 as? NSButton }
        let toggle = buttons.first { $0.identifier?.rawValue == "toggle" }!
        assert(!toggle.isEnabled)
        var action = ""; surface.action = { action = $0 }
        buttons.first { $0.identifier?.rawValue == "settings" }!.performClick(nil)
        assert(action == "settings")
        windowMode(raw, false, false)
        assert(window.isOpaque && !web.isHidden && surface.isHidden && window.contentView === host)
        windowMode(raw, true, true)
        assert(captionOverlay(window) === surface && web.isHidden && !surface.isHidden)
        print("PASS: transparent native backing, all appearance fields, reduced transparency, source visibility, partial updates, controls and WebView restoration")
    }
}
