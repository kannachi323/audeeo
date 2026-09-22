#if os(macOS)
import AppKit
import WebKit

// Public AppKit rendering keeps caption transparency independent of WKWebView's
// opaque backing. The existing WebView remains alive for session state/settings.
final class MacCaptionOverlay: NSView {
    var action: ((String) -> Void)?
    private(set) var controlsAnchor: NSRect?
    var gripOpacity: CGFloat { alphaValue * number("controlsOpacity", 1) }
    private let source = NSTextField(wrappingLabelWithString: "")
    private let translation = NSTextField(wrappingLabelWithString: "")
    private let status = NSTextField(labelWithString: "")
    private let message = NSTextField(wrappingLabelWithString: "")
    private let controls = NSView()
    private let header = NSView()
    private var buttons: [String: NSButton] = [:]
    private var tracking: NSTrackingArea?
    private var preferences: [String: Any] = [:]
    private var style: [String: Any] = [:]
    private var hovered = false
    private var sourceText = "", translatedText = ""
    private var fontSize: CGFloat = 24
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        appearance = NSAppearance(named: .darkAqua)
        autoresizingMask = [.width, .height]
        for label in [source, translation, status, message] {
            label.isEditable = false; label.isSelectable = false
            label.drawsBackground = false; label.isBezeled = false
            addSubview(label)
        }
        for label in [source, translation] {
            label.wantsLayer = true
            let shadow = NSShadow(); shadow.shadowColor = NSColor.black; shadow.shadowBlurRadius = 4; shadow.shadowOffset = NSSize(width: 0, height: -1)
            label.shadow = shadow
        }
        addSubview(header); addSubview(controls)
        status.font = .systemFont(ofSize: 12)
        message.font = .systemFont(ofSize: 12)
        message.textColor = .secondaryLabelColor
        for (id, symbol, title) in [("toggle", "stop.fill", "Stop captions"), ("history", "clock.arrow.circlepath", "History"), ("settings", "slider.horizontal.3", "Settings")] {
            addButton(id, symbol, title, to: header)
        }
        for (id, symbol, title) in [("input", "waveform", "Source"), ("languages", "character.bubble", "Languages"), ("context", "book", "Context"), ("audio", "speaker.wave.2", "Volume"), ("silence", "timer", "Auto-stop")] {
            addButton(id, symbol, title, to: controls)
        }
        setAccessibilityLabel("Live captions")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    private func addButton(_ id: String, _ symbol: String, _ title: String, to view: NSView) {
        let button = NSButton(image: NSImage(systemSymbolName: symbol, accessibilityDescription: title)!, target: self, action: #selector(pressed(_:)))
        button.identifier = NSUserInterfaceItemIdentifier(id)
        button.toolTip = title; button.setAccessibilityLabel(title)
        button.bezelStyle = .texturedRounded
        button.isBordered = false
        button.contentTintColor = NSColor(white: 0.74, alpha: 1)
        view.addSubview(button); buttons[id] = button
    }
    @objc private func pressed(_ sender: NSButton) {
        if let id = sender.identifier?.rawValue {
            if sender.superview === controls { controlsAnchor = convert(sender.bounds, from: sender) }
            action?(id)
        }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 48 { hovered = true; updateControls() }
        if event.modifierFlags.contains([.command, .option]), let window, [123, 124, 125, 126].contains(event.keyCode) {
            let step = event.modifierFlags.contains(.shift) ? 40.0 : 10.0
            nudgeMainWindow(Unmanaged.passUnretained(window).toOpaque(), event.keyCode == 123 ? -step : event.keyCode == 124 ? step : 0, event.keyCode == 126 ? -step : event.keyCode == 125 ? step : 0)
            return
        }
        if event.keyCode == 53 { action?("settings"); return }
        super.keyDown(with: event)
    }
    override func becomeFirstResponder() -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); tracking = area
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; updateControls() }
    override func mouseExited(with event: NSEvent) { hovered = false; updateControls() }
    private func number(_ key: String, _ fallback: Double) -> CGFloat {
        CGFloat((style[key] as? NSNumber)?.doubleValue ?? fallback)
    }
    private func color(_ key: String, _ fallback: String, alpha: CGFloat = 1) -> NSColor {
        let hex = (style[key] as? String) ?? fallback
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0x191919
        return NSColor(srgbRed: CGFloat((value >> 16) & 255)/255, green: CGFloat((value >> 8) & 255)/255, blue: CGFloat(value & 255)/255, alpha: alpha)
    }
    func update(_ payload: [String: Any]) {
        preferences = payload["preferences"] as? [String: Any] ?? [:]
        style = preferences["appearance"] as? [String: Any] ?? [:]
        sourceText = preferences["showSource"] as? Bool == false ? "" : payload["source"] as? String ?? ""
        translatedText = payload["translation"] as? String ?? ""
        fontSize = number("fontSize", 24)
        let opaque = payload["opaque"] as? Bool == true
        layer?.backgroundColor = color("backgroundColor", "#191919", alpha: opaque ? 1 : number("backgroundOpacity", 0)).cgColor
        layer?.borderColor = color("borderColor", "#3b3b3b", alpha: number("borderOpacity", 0)).cgColor
        layer?.borderWidth = number("borderWidth", 0)
        layer?.cornerRadius = number("borderRadius", 20)
        layer?.masksToBounds = true
        alphaValue = opaque ? 1 : number("overlayOpacity", 1)
        source.textColor = color("sourceTextColor", "#adadad")
        translation.textColor = color("textColor", "#f1f1f1")
        source.alphaValue = number("textOpacity", 1); translation.alphaValue = number("textOpacity", 1)
        status.stringValue = preferences["direction"] as? String ?? ""
        status.textColor = .secondaryLabelColor
        message.stringValue = preferences["message"] as? String ?? ""
        let phase = preferences["status"] as? String ?? "idle"
        buttons["toggle"]?.isEnabled = phase == "live" || phase == "idle"
        let title = phase == "live" ? "Stop captions" : "Start captions"
        buttons["toggle"]?.image = NSImage(systemSymbolName: phase == "live" ? "stop.fill" : "play.fill", accessibilityDescription: title)
        buttons["toggle"]?.setAccessibilityLabel(title); buttons["toggle"]?.toolTip = title
        window?.contentView?.subviews.compactMap { $0 as? PanelDragRegion }.forEach { $0.alphaValue = gripOpacity }
        updateControls(); needsLayout = true
    }
    private func updateControls() {
        let hidden = preferences["status"] as? String == "live" && preferences["autoHide"] as? Bool != false && !hovered && preferences["controlsOpen"] as? Bool != true
        let opacity = hidden ? 0 : number("controlsOpacity", 1)
        for view in [header, controls, status] { view.alphaValue = opacity; view.isHidden = hidden }
    }
    private func font(_ size: CGFloat) -> NSFont {
        let weights: [Int: NSFont.Weight] = [300:.light, 400:.regular, 500:.medium, 600:.semibold, 700:.bold, 800:.heavy]
        let weight = weights[Int(number("fontWeight", 400))] ?? .regular
        switch style["fontFamily"] as? String {
        case "mono": return .monospacedSystemFont(ofSize: size, weight: weight)
        case "serif": return NSFont(name: number("fontWeight", 400) >= 600 ? "Georgia-Bold" : "Georgia", size: size) ?? .systemFont(ofSize: size, weight: weight)
        case "sans": return NSFont(name: number("fontWeight", 400) >= 600 ? "Arial-BoldMT" : "ArialMT", size: size) ?? .systemFont(ofSize: size, weight: weight)
        default: return .systemFont(ofSize: size, weight: weight)
        }
    }
    private func fit(_ text: String, label: NSTextField, size: CGFloat, lines: Int) {
        label.font = font(size)
        label.maximumNumberOfLines = lines
        label.lineBreakMode = .byWordWrapping
        // Measure only the recent tail, so long sessions do not increase layout work.
        let chars = Array(text.suffix(2048))
        var low = 0, high = chars.count
        let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [.font: label.font!, .paragraphStyle: paragraph]
        while low < high {
            let mid = (low + high) / 2
            let box = (String(chars[mid...]) as NSString).boundingRect(with: NSSize(width: max(1, label.bounds.width - 6), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes)
            if box.height <= label.bounds.height { high = mid } else { low = mid + 1 }
        }
        label.stringValue = String(chars.dropFirst(low)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    override func layout() {
        super.layout()
        let width = max(1, bounds.width - 60)
        header.frame = NSRect(x: bounds.width - 130, y: 14, width: 110, height: 30)
        for (index, id) in ["toggle", "history", "settings"].enumerated() { buttons[id]?.frame = NSRect(x: index * 36, y: 0, width: 32, height: 30) }
        status.frame = NSRect(x: 30, y: 20, width: max(1, bounds.width - 180), height: 20)
        let controlWidth = min(352, bounds.width - 48)
        controls.frame = NSRect(x: (bounds.width-controlWidth)/2, y: bounds.height-62, width: controlWidth, height: 38)
        controls.wantsLayer = true; controls.layer?.backgroundColor = NSColor(white: 0.14, alpha: 0.95).cgColor; controls.layer?.cornerRadius = 18
        for (index, id) in ["input", "languages", "context", "audio", "silence"].enumerated() { buttons[id]?.frame = NSRect(x: CGFloat(index)*controlWidth/5, y: 2, width: controlWidth/5, height: 34) }
        let both = !sourceText.isEmpty && !translatedText.isEmpty
        let sourceSize = both ? fontSize * 0.8 : fontSize
        source.isHidden = sourceText.isEmpty; translation.isHidden = translatedText.isEmpty
        source.frame = NSRect(x: 30, y: 64, width: width, height: sourceSize * (both ? 1.35 : 2.7))
        translation.frame = NSRect(x: 30, y: both ? 64 + sourceSize * 1.35 + 10 : 64, width: width, height: fontSize * (both ? 1.35 : 2.7))
        fit(sourceText, label: source, size: sourceSize, lines: both ? 1 : 2)
        fit(translatedText, label: translation, size: fontSize, lines: both ? 1 : 2)
        message.frame = NSRect(x: 30, y: bounds.height-86, width: width, height: 20)
    }
}

func captionWebView(_ view: NSView) -> WKWebView? {
    if let web = view as? WKWebView { return web }
    return view.subviews.lazy.compactMap { captionWebView($0) }.first
}
func captionOverlay(_ window: NSWindow) -> MacCaptionOverlay? {
    window.contentView?.subviews.first { $0 is MacCaptionOverlay } as? MacCaptionOverlay
}
func setNativeCaptionMode(_ window: NSWindow, _ overlay: Bool) {
    guard let content = window.contentView else { return }
    let web = captionWebView(content)
    // Tauri retains its content host. Never remove/reparent the session WebView.
    if overlay {
        if captionOverlay(window) == nil {
            let surface = MacCaptionOverlay(frame: content.bounds)
            surface.isHidden = true
            content.addSubview(surface)
        }
        web?.isHidden = true
    } else {
        captionOverlay(window)?.isHidden = true
        web?.isHidden = false
    }
    let surface = captionOverlay(window)
    let entering = overlay && surface?.isHidden == true
    surface?.isHidden = !overlay
    if entering { window.makeFirstResponder(surface) }
    if !overlay && window.firstResponder === surface { window.makeFirstResponder(web) }
}
@_cdecl("audeeo_update_caption_overlay")
public func updateCaptionOverlay(_ raw: UnsafeMutableRawPointer, _ json: UnsafePointer<CChar>, _ callback: @escaping @convention(c) (UnsafePointer<CChar>) -> Void) {
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    guard let data = String(cString: json).data(using: .utf8), let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    // Prepare the surface before window_mode; IPC arrival order need not match React effects.
    if captionOverlay(window) == nil, let content = window.contentView {
        let surface = MacCaptionOverlay(frame: content.bounds); surface.isHidden = true; content.addSubview(surface)
    }
    captionOverlay(window)?.action = { value in value.withCString { callback($0) } }
    captionOverlay(window)?.update(payload)
}
#endif
