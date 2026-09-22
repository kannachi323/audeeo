import {invoke} from "@tauri-apps/api/core";
import {minutePacks,type MinutePackId,type MinutePackOffer,type PackPurchaseResult} from "../../shared/minutePacks";
import { isTauri } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { config } from "./config";
import { nativePurchase, syncSubscriptionUsage } from "./account";
import type { CustomerInfo, Purchases as WebPurchases } from "@revenuecat/purchases-js";

export const PRO_ENTITLEMENT = "audeeo_pro";
export type Plan = { id: "yearly" | "monthly"; price: string; productID: string };
export type SubscriptionInfo = {
  active: boolean; productID: string | null; expiresAt: string | null;
  willRenew: boolean; managementURL: string | null;
  paidPrice?: string | null; billingPeriod?: string | null; periodType?: string | null;
};
export function hasPro(info: CustomerInfo): boolean {
  return Object.hasOwn(info.entitlements.active, PRO_ENTITLEMENT);
}
function summarize(info: CustomerInfo): SubscriptionInfo {
  const entitlement = info.entitlements.active[PRO_ENTITLEMENT];
  const subscription = entitlement && info.subscriptionsByProductIdentifier?.[entitlement.productIdentifier];
  return {
    active: hasPro(info), productID: entitlement?.productIdentifier ?? null,
    expiresAt: entitlement?.expirationDate?.toISOString() ?? null,
    willRenew: entitlement?.willRenew ?? false, managementURL: info.managementURL,
    paidPrice: subscription?.price?.formattedPrice ?? null,
    periodType: subscription?.periodType ?? null,
  };
}
let web: WebPurchases | undefined;
let owner: string | undefined;
let operations: Promise<unknown> = Promise.resolve();
export function nativeBilling(platform?: string) {
  if (!isTauri()) return false;
  // Preserve the native default for callers that do not know their platform.
  // Windows desktop uses RevenueCat Web Billing inside the Tauri WebView.
  return (platform === undefined || platform === "macos") && config.distribution === "app-store";
}
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
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation);
  operations = result.catch(() => {});
  return result;
}
export function billingCheckoutURL() {
  return config.billingEnvironment === 'sandbox' ? 'http://localhost:5173/pricing' : 'https://audeeo.app/pricing';
}
async function checkSandboxAccess(session: Session) {
  if(config.billingEnvironment === 'sandbox') {
    const usage=await syncSubscriptionUsage(session);
    if(!usage.sandbox) throw new Error('Sandbox checkout is unavailable. Refresh and try again.');
  }
}
export function customerInfo(session: Session, platform?: string): Promise<SubscriptionInfo> {
  return exclusive(async () => nativeBilling(platform)
    ? nativePurchase("info", session)
    : summarize(await (await client(session)).getCustomerInfo()));
}
export function subscriptionPlans(session: Session, platform?: string): Promise<Plan[]> {
  return exclusive(async () => {
    if (nativeBilling(platform)) return (await nativePurchase("offer", session)).plans;
    const offering = (await (await client(session)).getOfferings()).current;
    return (["yearly", "monthly"] as const).flatMap(id => {
      const pkg = id === "yearly" ? offering?.annual : offering?.monthly;
      return pkg ? [{ id, price: pkg.webBillingProduct.currentPrice.formattedPrice,
        productID: pkg.webBillingProduct.identifier }] : [];
    });
  });
}
export function subscriptionAction(session: Session, action: "restore" | "paywall" | "manage" | "yearly" | "monthly", platform?: string) {
  return exclusive(async (): Promise<SubscriptionInfo | null> => {
    if(action === 'yearly' || action === 'monthly' || action === 'paywall') await checkSandboxAccess(session);
    if (nativeBilling(platform)) {
      const result = await nativePurchase(action === "yearly" || action === "monthly" ? `purchase:${action}` : action, session);
      return result.cancelled ? null : result;
    }
    if(isTauri() && (action === "yearly" || action === "monthly" || action === "paywall")) { await invoke("open_external_url",{url:billingCheckoutURL()}); return null; }
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

export function minutePackOffers(session:Session,platform?:string):Promise<MinutePackOffer[]> {
 return exclusive(async()=>{
  if(nativeBilling(platform))return (await nativePurchase('packs',session)).packs ?? [];
  const offering=(await (await client(session)).getOfferings()).all['minute_packs'];
  return minutePacks.flatMap(pack=>{const pkg=offering?.availablePackages.find(p=>p.identifier===pack.id && p.webBillingProduct.identifier===pack.web);
   return pkg?[{id:pack.id,minutes:pack.minutes,price:pkg.webBillingProduct.currentPrice.formattedPrice,productID:pack.web}]:[];});
 });
}
export function purchaseMinutePack(session:Session,id:MinutePackId,platform?:string,quantity=1):Promise<PackPurchaseResult> {
 return exclusive(async()=>{
  if(!Number.isInteger(quantity)||quantity<1||quantity>10)throw new Error('Choose between 1 and 10 packs');
  if(quantity>1&&!nativeBilling(platform))throw new Error('Multiple packs are available in the Apple app');
  await checkSandboxAccess(session);
  const pack=minutePacks.find(p=>p.id===id);if(!pack)throw new Error('Unknown minute pack');
  if(nativeBilling(platform)){const result=await nativePurchase(`pack:${id}:${quantity}`,session);return result.cancelled ? {status:'cancelled'} : {status:'pending',transactionId:result.transactionId,productID:pack.apple};}
  if(isTauri()) {await invoke('open_external_url',{url:`${billingCheckoutURL()}?pack=${id}`});return {status:'external'};}
  const sdk=await client(session);const offering=(await sdk.getOfferings()).all['minute_packs'];
  const pkg=offering?.availablePackages.find(p=>p.identifier===id && p.webBillingProduct.identifier===pack.web);
  if(!pkg)throw new Error('Minute pack unavailable');
  const {PurchasesError,ErrorCode}=await import('@revenuecat/purchases-js');
  try{const result=await sdk.purchase({rcPackage:pkg,customerEmail:session.user.email});return {status:'pending',transactionId:result.storeTransaction.storeTransactionId,productID:pack.web};}
  catch(e){if(e instanceof PurchasesError && e.errorCode===ErrorCode.UserCancelledError)return {status:'cancelled'};throw e;}
 });
}
