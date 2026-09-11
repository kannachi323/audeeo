import Foundation
#if canImport(RevenueCat)
import RevenueCat
#endif
#if os(iOS) && canImport(RevenueCatUI)
import UIKit
import RevenueCatUI

@MainActor
private final class BillingPresentation: NSObject, PaywallViewControllerDelegate, CustomerCenterViewControllerDelegate {
    static var current: BillingPresentation?
    let finish: () -> Void
    init(finish: @escaping () -> Void) { self.finish = finish }
    private func complete() {
        guard Self.current === self else { return }
        Self.current = nil
        finish()
    }
    func paywallViewControllerWasDismissed(_ controller: PaywallViewController) { complete() }
    func customerCenterViewControllerWasDismissed(_ controller: CustomerCenterViewController) { complete() }
}
#endif

public typealias PurchaseCallback = @convention(c) (UnsafePointer<CChar>) -> Void
#if canImport(RevenueCat)
@MainActor private var billingBusy = false
private func customerPayload(_ info: CustomerInfo) -> [String: Any] {
    let entitlement = info.entitlements.active["audeeo_pro"]
    return ["active": entitlement != nil,
            "productID": entitlement?.productIdentifier as Any? ?? NSNull(),
            "expiresAt": entitlement?.expirationDate.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
            "willRenew": entitlement?.willRenew ?? false,
            "managementURL": info.managementURL?.absoluteString as Any? ?? NSNull()]
}
#endif

@_cdecl("audeeo_purchase_action")
public func purchaseAction(_ operation: UnsafePointer<CChar>, _ owner: UnsafePointer<CChar>, _ apiKey: UnsafePointer<CChar>, _ callback: @escaping PurchaseCallback) {
    let input = String(cString: operation), userID = String(cString: owner), key = String(cString: apiKey)
    let request = (try? JSONSerialization.jsonObject(with: Data(input.utf8))) as? [String: String] ?? [:]
    let action = request["action"] ?? input
    let send: ([String: Any]) -> Void = { payload in
        var result = payload
        result["requestID"] = request["requestID"]
        guard let data = try? JSONSerialization.data(withJSONObject: result), let text = String(data: data, encoding: .utf8) else { return }
        text.withCString { callback($0) }
    }
    guard UUID(uuidString: userID) != nil, !key.isEmpty else { send(["error": "Set the RevenueCat Apple API key to enable App Store purchases."]); return }
    #if canImport(RevenueCat)
    Task { @MainActor in
        guard !billingBusy else { send(["error": "Finish the current subscription request first."]); return }
        billingBusy = true
        let finish: ([String: Any]) -> Void = { payload in billingBusy = false; send(payload) }
        do {
            if !Purchases.isConfigured { Purchases.configure(withAPIKey: key, appUserID: userID) }
            else if Purchases.shared.appUserID != userID { _ = try await Purchases.shared.logIn(userID) }
            switch action {
            case "info":
                finish(customerPayload(try await Purchases.shared.customerInfo(fetchPolicy: .fetchCurrent)))
            case "restore":
                var result = customerPayload(try await Purchases.shared.restorePurchases())
                result["restored"] = true
                finish(result)
            case "offer":
                let offering = try await Purchases.shared.offerings().current
                let plans: [[String: Any]] = [("yearly", offering?.annual), ("monthly", offering?.monthly)].compactMap { plan, package in
                    guard let package else { return nil }
                    return ["id": plan, "price": package.storeProduct.localizedPriceString, "productID": package.storeProduct.productIdentifier]
                }
                finish(["plans": plans])
            case "purchase", "purchase:monthly", "purchase:yearly":
                let offering = try await Purchases.shared.offerings().current
                let package = action == "purchase:yearly" ? offering?.annual : offering?.monthly
                guard let package else { finish(["error": "This subscription is not available. Please try again later."]); return }
                let purchase = try await Purchases.shared.purchase(package: package)
                var result = customerPayload(purchase.customerInfo)
                result["cancelled"] = purchase.userCancelled
                result["purchased"] = !purchase.userCancelled
                finish(result)
            case "paywall", "manage":
                #if os(iOS) && canImport(RevenueCatUI)
                guard var presenter = UIApplication.shared.connectedScenes
                    .compactMap({ $0 as? UIWindowScene }).filter({ $0.activationState == .foregroundActive })
                    .flatMap({ $0.windows }).first(where: { $0.isKeyWindow })?.rootViewController else {
                    finish(["error": "Open Audeeo before managing subscriptions."]); return
                }
                while let presented = presenter.presentedViewController { presenter = presented }
                let coordinator = BillingPresentation {
                    Task { @MainActor in
                        do { finish(customerPayload(try await Purchases.shared.customerInfo(fetchPolicy: .fetchCurrent))) }
                        catch { finish(["error": "Could not refresh subscription status. Try Refresh purchases."]) }
                    }
                }
                BillingPresentation.current = coordinator
                let controller: UIViewController
                if action == "paywall" {
                    let paywall = PaywallViewController(displayCloseButton: true)
                    paywall.delegate = coordinator
                    controller = paywall
                } else { controller = CustomerCenterViewController(delegate: coordinator) }
                presenter.present(controller, animated: true)
                #else
                finish(["error": "This billing screen is available in the iOS app. Use the plan buttons or your store subscription settings."])
                #endif
            default: finish(["error": "Unsupported purchase action."])
            }
        } catch {
            let nsError = error as NSError
            if nsError.code == ErrorCode.purchaseCancelledError.rawValue {
                finish(["cancelled": true])
            } else { finish(["error": error.localizedDescription]) }
        }
    }
    #else
    send(["error": "This build does not include RevenueCat. Build with scripts/apple-native-build.sh."])
    #endif
}
