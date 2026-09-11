import { isTauri } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { config } from "./config";
import { nativePurchase } from "./account";
import type { CustomerInfo, Purchases as WebPurchases } from "@revenuecat/purchases-js";

export const PRO_ENTITLEMENT = "audeeo_pro";
export type Plan = { id: "yearly" | "monthly"; price: string; productID: string };
export type SubscriptionInfo = {
  active: boolean; productID: string | null; expiresAt: string | null;
  willRenew: boolean; managementURL: string | null;
};
export function hasPro(info: CustomerInfo): boolean {
  return Object.hasOwn(info.entitlements.active, PRO_ENTITLEMENT);
}
function summarize(info: CustomerInfo): SubscriptionInfo {
  const entitlement = info.entitlements.active[PRO_ENTITLEMENT];
  return {
    active: hasPro(info), productID: entitlement?.productIdentifier ?? null,
    expiresAt: entitlement?.expirationDate?.toISOString() ?? null,
    willRenew: entitlement?.willRenew ?? false, managementURL: info.managementURL,
  };
}
let web: WebPurchases | undefined;
let owner: string | undefined;
let busy = false;
async function client(session: Session) {
  if (!config.revenueCatWebKey) throw new Error("Web subscriptions are not configured.");
  const { Purchases } = await import("@revenuecat/purchases-js");
  if (!web) {
    web = Purchases.configure({ apiKey: config.revenueCatWebKey, appUserId: session.user.id });
    owner = session.user.id;
  } else if (owner !== session.user.id) {
    await web.changeUser(session.user.id);
    owner = session.user.id;
  }
  return web;
}
// All SDK operations share a lock so account switching cannot race a checkout.
async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error("Finish the current subscription request first.");
  busy = true;
  try { return await operation(); } finally { busy = false; }
}
export function customerInfo(session: Session): Promise<SubscriptionInfo> {
  return exclusive(async () => isTauri()
    ? nativePurchase("info", session)
    : summarize(await (await client(session)).getCustomerInfo()));
}
export function subscriptionPlans(session: Session): Promise<Plan[]> {
  return exclusive(async () => {
    if (isTauri()) return (await nativePurchase("offer", session)).plans;
    const offering = (await (await client(session)).getOfferings()).current;
    return (["yearly", "monthly"] as const).flatMap(id => {
      const pkg = id === "yearly" ? offering?.annual : offering?.monthly;
      return pkg ? [{ id, price: pkg.webBillingProduct.currentPrice.formattedPrice,
        productID: pkg.webBillingProduct.identifier }] : [];
    });
  });
}
export function subscriptionAction(session: Session, action: "restore" | "paywall" | "manage" | "yearly" | "monthly") {
  return exclusive(async (): Promise<SubscriptionInfo | null> => {
    if (isTauri()) {
      const result = await nativePurchase(action === "yearly" || action === "monthly" ? `purchase:${action}` : action, session);
      return result.cancelled ? null : result;
    }
    const sdk = await client(session);
    if (action === "restore") return summarize(await sdk.getCustomerInfo());
    if (action === "manage") throw new Error("Use the Manage subscription link or the link in your billing email.");
    const { PurchasesError, ErrorCode } = await import("@revenuecat/purchases-js");
    try {
      let result;
      if (action === "paywall") result = await sdk.presentPaywall({ customerEmail: session.user.email });
      else {
        const offering = (await sdk.getOfferings()).current;
        const pkg = action === "yearly" ? offering?.annual : offering?.monthly;
        if (!pkg) throw new Error("This subscription is not available. Please try again later.");
        result = await sdk.purchase({ rcPackage: pkg, customerEmail: session.user.email });
      }
      return summarize(result.customerInfo);
    } catch (error) {
      if (error instanceof PurchasesError && error.errorCode === ErrorCode.UserCancelledError) return null;
      throw error;
    }
  });
}
export function subscriptionManagementURL(info: SubscriptionInfo | null): string | null {
  if (!info?.managementURL) return null;
  try { const url = new URL(info.managementURL); return url.protocol === "https:" ? url.href : null; }
  catch { return null; }
}
