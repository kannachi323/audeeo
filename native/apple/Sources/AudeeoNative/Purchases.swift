import Foundation
#if canImport(RevenueCat)
import RevenueCat
#endif

public typealias PurchaseCallback = @convention(c) (UnsafePointer<CChar>) -> Void
#if canImport(RevenueCat)
@MainActor private var billingBusy = false
private func customerPayload(_ info: CustomerInfo) -> [String: Any] {
    let entitlement = info.entitlements.active["audeeo_pro"]
    let subscription = entitlement.flatMap { info.subscriptionsByProductIdentifier[$0.productIdentifier] }
    return ["active": entitlement != nil,
            "productID": entitlement?.productIdentifier as Any? ?? NSNull(),
            "expiresAt": entitlement?.expirationDate.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull(),
            "willRenew": entitlement?.willRenew ?? false,
            "paidPrice": subscription?.price?.formatted as Any? ?? NSNull(),
            "periodType": subscription.map { String(describing: $0.periodType).lowercased() } as Any? ?? NSNull(),
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
            case "packs":
                let offering = try await Purchases.shared.offerings().all["minute_packs"]
                let packs: [[String: Any]] = [60,180,600].compactMap { minutes in
                    let id = "minutes_\(minutes)"
                    guard let package = offering?.availablePackages.first(where: { $0.identifier == id && $0.storeProduct.productIdentifier == "audeeo_\(id)" }) else { return nil }
                    let formatter = package.storeProduct.priceFormatter
                    let prices = (1...10).compactMap { quantity in
                        formatter?.string(from: NSDecimalNumber(decimal: package.storeProduct.price * Decimal(quantity)))
                    }
                    return ["id":id,"minutes":minutes,"price":package.storeProduct.localizedPriceString,"productID":package.storeProduct.productIdentifier,"pricesByQuantity":prices]
                }
                finish(["packs":packs])
            case let value where value.hasPrefix("pack:"):
                let parts = value.split(separator: ":", omittingEmptySubsequences: false)
                guard parts.count == 2 || parts.count == 3,
                      ["minutes_60", "minutes_180", "minutes_600"].contains(String(parts[1])),
                      let quantity = Int(parts.count == 3 ? String(parts[2]) : "1"), (1...10).contains(quantity)
                else { finish(["error":"Invalid pack quantity."]); return }
                let id = String(parts[1])
                let offering = try await Purchases.shared.offerings().all["minute_packs"]
                guard let package = offering?.availablePackages.first(where: { $0.identifier == id && $0.storeProduct.productIdentifier == "audeeo_\(id)" }) else { finish(["error":"Minute pack unavailable."]); return }
                let purchase = try await Purchases.shared.purchase(PurchaseParams.Builder(package: package).with(quantity: quantity).build())
                finish(["cancelled":purchase.userCancelled,"purchased":!purchase.userCancelled,"transactionId":purchase.transaction?.transactionIdentifier ?? ""])
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
