import Foundation
import AuthenticationServices
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif
public typealias OAuthCallback = @convention(c) (UnsafePointer<CChar>) -> Void

// Retain the session and presentation anchor until completion. All access is on
// the main queue. The callback belongs to this process, not Launch Services'
// registered audeeo:// application (which may be a different installed build).
private final class OAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    static var active: OAuthSession?
    private var session: ASWebAuthenticationSession?
    private let anchor: ASPresentationAnchor
    private let callback: OAuthCallback

    init(anchor: ASPresentationAnchor, callback: @escaping OAuthCallback) {
        self.anchor = anchor
        self.callback = callback
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor
    }

    func start(url: URL) {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "audeeo") { [weak self] url, error in
            DispatchQueue.main.async {
                guard let self = self, OAuthSession.active === self else { return }
                if let url = url {
                    self.complete(url.absoluteString)
                } else {
                    let code = (error as? ASWebAuthenticationSessionError)?.code
                    self.complete("audeeo://auth/callback?error=\(code == .canceledLogin ? "cancelled" : "browser_unavailable")")
                }
            }
        }
        session.presentationContextProvider = self
        self.session = session
        if !session.start() {
            complete("audeeo://auth/callback?error=browser_unavailable")
        }
    }

    private func complete(_ url: String) {
        session = nil
        OAuthSession.active = nil
        url.withCString { callback($0) }
        #if os(macOS)
        anchor.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        #endif
    }
}

@_cdecl("audeeo_begin_oauth")
public func beginOAuth(_ raw: UnsafePointer<CChar>, _ callback: @escaping OAuthCallback) {
    let text = String(cString: raw)
    DispatchQueue.main.async {
        guard let url = URL(string: text), url.scheme == "https" else {
            "audeeo://auth/callback?error=invalid_url".withCString { callback($0) }
            return
        }
        guard OAuthSession.active == nil else {
            "audeeo://auth/callback?error=already_in_progress".withCString { callback($0) }
            return
        }
        #if os(macOS)
        let anchor = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: { $0.isVisible })
        #elseif os(iOS)
        let anchor = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow })
        #endif
        guard let anchor = anchor else {
            "audeeo://auth/callback?error=browser_unavailable".withCString { callback($0) }
            return
        }
        let owner = OAuthSession(anchor: anchor, callback: callback)
        OAuthSession.active = owner
        owner.start(url: url)
    }
}
