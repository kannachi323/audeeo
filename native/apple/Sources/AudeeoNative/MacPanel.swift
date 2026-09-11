#if os(macOS)
import AppKit
import WebKit
import QuartzCore

// Receive the original AppKit mouse event directly; no WebView/IPC timing is involved.
final class PanelDragRegion: NSView {
    private var monitor: Any?
    private var fadeTimer: Timer?
    private let pill = NSView()
    private let icon = NSImageView()
    private var hoverTracking: NSTrackingArea?
    private(set) var hovered = false
    private(set) var gripVisible = false
    override init(frame: NSRect) {
        super.init(frame: frame)
        pill.frame = NSRect(x: (frame.width - 24) / 2, y: 6, width: 24, height: 12)
        pill.autoresizingMask = [.minXMargin, .maxXMargin]
        pill.wantsLayer = true
        pill.layer?.cornerRadius = 6
        pill.layer?.borderWidth = 1
        pill.layer?.borderColor = NSColor(white: 0.38, alpha: 1).cgColor
        pill.layer?.backgroundColor = NSColor(white: 0.19, alpha: 1).cgColor
        pill.alphaValue = 0
        addSubview(pill)
        // Lucide GripHorizontal: original 24x24 circle geometry (ISC license).
        // Render natively so the drag target receives the original mouse event.
        icon.image = NSImage(size: NSSize(width: 24, height: 24), flipped: false) { _ in
            NSColor.secondaryLabelColor.setStroke()
            for x in [5.0, 12.0, 19.0] {
                for y in [9.0, 15.0] {
                    let dot = NSBezierPath(ovalIn: NSRect(x: x - 1, y: y - 1, width: 2, height: 2))
                    dot.lineWidth = 2; dot.stroke()
                }
            }
            return true
        }
        icon.frame = NSRect(x: 6, y: 0, width: 12, height: 12)
        icon.autoresizingMask = [.minXMargin, .maxXMargin]
        pill.addSubview(icon)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func resetCursorRects() {
        addCursorRect(bounds, cursor: initialPointer == nil ? .openHand : .closedHand)
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTracking { removeTrackingArea(hoverTracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); hoverTracking = area
    }
    func setHovered(_ value: Bool) {
        hovered = value
        pill.layer?.backgroundColor = NSColor(white: value ? 0.29 : 0.19, alpha: 1).cgColor
        if value { noteActivity() }
    }
    override func mouseEntered(with event: NSEvent) { setHovered(true); NSCursor.openHand.set() }
    override func mouseExited(with event: NSEvent) { setHovered(false) }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
        fadeTimer?.invalidate()
        guard let window else { return }
        window.acceptsMouseMovedEvents = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown, .leftMouseDragged, .leftMouseUp]) { [weak self] event in
            if let self, event.window === self.window,
               self.bounds.contains(self.convert(event.locationInWindow, from: nil)) { self.noteActivity() }
            return event
        }
    }
    func noteActivity() {
        fadeTimer?.invalidate()
        gripVisible = true
        pill.layer?.removeAllAnimations()
        pill.alphaValue = 1
        fadeTimer = Timer.scheduledTimer(withTimeInterval: 1.8, repeats: false) { [weak self] _ in self?.fadeGrip() }
    }
    func fadeGrip() {
        if initialPointer != nil { noteActivity(); return }
        gripVisible = false
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.3
            pill.animator().alphaValue = 0
        }
    }
    deinit {
        fadeTimer?.invalidate()
        if let monitor { NSEvent.removeMonitor(monitor) }
    }
    private var initialPointer: NSPoint?
    private var initialOrigin: NSPoint?
    override func hitTest(_ point: NSPoint) -> NSView? { bounds.contains(convert(point, from: superview)) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        noteActivity()
        initialPointer = window.convertPoint(toScreen: event.locationInWindow)
        initialOrigin = window.frame.origin
        NSCursor.closedHand.set()
        window.invalidateCursorRects(for: self)
    }
    override func mouseDragged(with event: NSEvent) {
        guard let window, let pointer = initialPointer, let origin = initialOrigin else { return }
        NSCursor.closedHand.set()
        let current = window.convertPoint(toScreen: event.locationInWindow)
        window.setFrameOrigin(NSPoint(x: origin.x + current.x - pointer.x, y: origin.y + current.y - pointer.y))
    }
    override func mouseUp(with event: NSEvent) {
        initialPointer = nil
        initialOrigin = nil
        window?.invalidateCursorRects(for: self)
        if hovered { NSCursor.openHand.set() } else { NSCursor.arrow.set() }
        noteActivity()
    }
}
// The caller dispatches on AppKit's main thread. Preserve placement while changing pages.
@_cdecl("audeeo_resize_window")
public func resizeMainWindow(_ raw: UnsafeMutableRawPointer, _ contentHeight: Double) {
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    guard let visible = (window.screen ?? NSScreen.main)?.visibleFrame else { return }
    window.isMovable = true
    let old = window.frame
    let desired = window.frameRect(forContentRect: NSRect(x: 0, y: 0, width: old.width, height: contentHeight))
    let height = min(desired.height, visible.height)
    let width = min(old.width, visible.width)
    let x = min(max(old.minX, visible.minX), visible.maxX - width)
    let y = min(max(old.maxY - height, visible.minY), visible.maxY - height)
    let target = NSRect(x: x, y: y, width: width, height: height)
    guard !window.inLiveResize, !NSEqualRects(window.frame, target) else { return }
    // Page navigation should resize immediately, without blocking on an AppKit animation.
    window.setFrame(target, display: true, animate: false)
}
@_cdecl("audeeo_nudge_window")
public func nudgeMainWindow(_ raw: UnsafeMutableRawPointer, _ dx: Double, _ dy: Double) {
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    guard let screen = (window.screen ?? NSScreen.main)?.visibleFrame else { return }
    let frame = window.frame
    window.setFrameOrigin(NSPoint(
        x: min(max(frame.minX + dx, screen.minX), screen.maxX - frame.width),
        y: min(max(frame.minY - dy, screen.minY), screen.maxY - frame.height)))
}
@_cdecl("audeeo_present_settings")
public func presentSettings(_ raw: UnsafeMutableRawPointer) {
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    window.makeKeyAndOrderFront(nil)
}
@_cdecl("audeeo_window_mode")
public func windowMode(_ raw: UnsafeMutableRawPointer, _ overlay: Bool, _ clear: Bool) {
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    let frame = window.frame
    let mask: NSWindow.StyleMask = [.titled, .fullSizeContentView, .resizable, .closable, .miniaturizable]
    if window.styleMask != mask { window.styleMask = mask; window.setFrame(frame, display: true) }
    window.isMovable = true
    window.level = overlay ? .floating : .normal
    window.collectionBehavior = overlay ? [.canJoinAllSpaces, .fullScreenAuxiliary] : [.managed]
    let _ = clear // CSS owns the single visible panel surface and accessibility fallback.
    func clearWebBackground(_ view: NSView) {
        if let web = view as? WKWebView {
            // Same macOS WKWebView background policy used by Wry transparency.
            web.setValue(false, forKey: "drawsBackground")
            web.underPageBackgroundColor = .clear
        }
        view.subviews.forEach(clearWebBackground)
    }
    if let content = window.contentView {
        clearWebBackground(content)
        // Do not mask or relayer Tauri's WebView host during native resizing.
        // The single rounded surface is drawn and clipped by CSS.
        content.layer?.masksToBounds = false
        content.layer?.cornerRadius = 0
        let existing = content.subviews.first { $0.identifier?.rawValue == "audeeo-overlay-grip" }
        if existing == nil {
            let grip = PanelDragRegion(frame: NSRect(x: content.bounds.midX - 24, y: content.bounds.height - 18, width: 48, height: 24))
            grip.identifier = NSUserInterfaceItemIdentifier("audeeo-overlay-grip")
            grip.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin]
            grip.setAccessibilityLabel("Drag to move captions; Command Option arrow keys also move the window")
            content.addSubview(grip)
        }
        existing?.isHidden = false
    }
    window.isOpaque = false // Transparent pixels outside the rounded content.
    window.backgroundColor = .clear
    window.hasShadow = false
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.titlebarSeparatorStyle = .none
    window.isMovableByWindowBackground = false
    for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
        window.standardWindowButton(button)?.isHidden = true
    }
}
#endif

#if os(macOS)
// A single webview supplies the controls; it is never ordered as an app window.
// NSPopover owns positioning, screen-edge collision, focus and outside dismissal.
final class ControlsPopover: NSObject, NSPopoverDelegate {
    static let shared = ControlsPopover()
    let popover = NSPopover()
    var closed: (@convention(c) (Int64) -> Void)?
    var presentation: Int64 = 0
    override init() {
        super.init()
        popover.appearance = NSAppearance(named: .darkAqua)
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
    }
    func show(main: NSWindow, host: NSWindow, anchor: NSRect, height: CGFloat) {
        guard let parent = main.contentView else { return }
        host.orderOut(nil)
        if popover.contentViewController == nil {
            guard let content = host.contentView else { return }
            // Tao's ns_view() unconditionally unwraps this window's contentView.
            // Keep its root installed throughout the host lifetime, including teardown.
            func findWebView(_ view: NSView) -> WKWebView? {
                if let web = view as? WKWebView { return web }
                return view.subviews.lazy.compactMap { findWebView($0) }.first
            }
            guard let web = findWebView(content) else { return }
            if web === content {
                // A bare WKWebView host must also retain a non-null native root.
                host.contentView = NSView(frame: content.frame)
            } else {
                web.removeFromSuperview()
            }
            let controller = NSViewController()
            controller.view = NSView(frame: NSRect(x: 0, y: 0, width: 310, height: height))
            web.frame = controller.view.bounds
            web.autoresizingMask = [.width, .height]
            controller.view.addSubview(web)
            popover.contentViewController = controller
        }
        let rect = NSRect(x: anchor.minX,
            y: parent.isFlipped ? anchor.minY : parent.bounds.height - anchor.maxY,
            width: anchor.width, height: anchor.height)
        let screenAnchor = main.convertToScreen(parent.convert(rect, to: nil))
        let screen = (main.screen ?? NSScreen.main)?.visibleFrame
        // Reserve the arrow/chrome and scroll long menus instead of flipping above captions.
        let availableBelow = screen.map { max(1, screenAnchor.minY - $0.minY - 28) } ?? height
        popover.contentSize = NSSize(width: 310, height: min(height, availableBelow))
        if popover.isShown { return } // Resizing an open select must preserve keyboard focus.
        popover.show(relativeTo: rect, of: parent, preferredEdge: .minY)
        if let view = popover.contentViewController?.view {
            view.window?.level = main.level
            view.window?.makeFirstResponder(view)
        }
    }
    func popoverDidClose(_ notification: Notification) { closed?(presentation) }
}
@_cdecl("audeeo_show_controls_popover")
public func showControlsPopover(_ main: UnsafeMutableRawPointer, _ host: UnsafeMutableRawPointer,
    _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ contentHeight: Double,
    _ presentation: Int64, _ closed: @escaping @convention(c) (Int64) -> Void) {
    let controls = ControlsPopover.shared
    controls.presentation = presentation
    controls.closed = closed
    controls.show(main: Unmanaged<NSWindow>.fromOpaque(main).takeUnretainedValue(),
        host: Unmanaged<NSWindow>.fromOpaque(host).takeUnretainedValue(),
        anchor: NSRect(x: x, y: y, width: width, height: height), height: contentHeight)
}
@_cdecl("audeeo_close_controls_popover")
public func closeControlsPopover() {
    let controls = ControlsPopover.shared
    controls.closed = nil // The caller already updated its state; avoid a stale close on tab switches.
    controls.popover.performClose(nil)
}
#endif
