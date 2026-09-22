import {reconcilePackPurchases,synchronizePackPurchases} from "./packs";
import type { AccountUsage, SubscriptionSync } from "../../../shared/billing";

export interface Env {
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  DEV_USER_IDS?: string;
  BILLING_TEST_USER_IDS?: string;
  APP_REVIEW_USER_IDS?: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  OPENAI_API_KEY?: string;
  SUMMARY_MODEL?: string;
  SONIOX_API_KEY?: string;
  SONIOX_MODEL?: string;
  REVENUECAT_SECRET_KEY: string;
  MINUTE_PACKS_ENABLED?: string;
  REVENUECAT_V2_SECRET_KEY?: string;
  REVENUECAT_PROJECT_ID?: string;
  REVENUECAT_WEBHOOK_AUTH_KEY: string;
  REVENUECAT_ENTITLEMENT: string;
  ALLOWED_ORIGINS: string;
  MAX_SESSION_SECONDS: string;
}
export async function db(
  env: Env,
  path: string,
  body?: unknown,
  method = "POST",
  prefer = "return=representation",
) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("Account service unavailable");
  return r.status === 204 ? undefined : (r.json() as Promise<any>);
}
export async function identity(
  env: Env,
  token: string,
  allowDeletion = false,
): Promise<{ id: string; expiresAt: number }> {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("Sign in again to continue.");
  const user = (await r.json()) as { id: string; app_metadata?: {audeeo_deletion?: unknown} };
  if (!allowDeletion && user.app_metadata?.audeeo_deletion)
    throw new Error("Account deletion is pending. Open Account settings to finish deleting your account.");
  // The token was validated by Supabase above. Decode only to bound this socket's lifetime.
  const claims = JSON.parse(
    atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  ) as { exp: number; sub: string };
  if (
    claims.sub !== user.id ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now()
  )
    throw new Error("Sign in again to continue.");
  return { id: user.id, expiresAt: claims.exp * 1000 };
}
/** Monthly included minutes renew on the purchase anniversary even on yearly plans.
 * Clamp month-end anniversaries (Jan 31 -> Feb 28), preserving UTC time.
 */
export function allowancePeriod(start: string, end: string, now = new Date()) {
  const origin = new Date(start), expiry = new Date(end);
  if (!Number.isFinite(origin.getTime()) || !Number.isFinite(expiry.getTime()) || origin > now || expiry <= origin)
    throw new Error("Invalid subscription period");
  const anniversary = (offset: number) => {
    const result = new Date(origin);
    result.setUTCDate(1);
    result.setUTCMonth(origin.getUTCMonth() + offset);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(origin.getUTCDate(), lastDay));
    return result;
  };
  let months = Math.max(0, (now.getUTCFullYear() - origin.getUTCFullYear()) * 12 + now.getUTCMonth() - origin.getUTCMonth());
  if (anniversary(months) > now) months--;
  return { start: anniversary(months).toISOString(), end: new Date(Math.min(anniversary(months + 1).getTime(), expiry.getTime())).toISOString() };
}
export async function accountUsage(env: Env, owner: string, sandbox = false): Promise<AccountUsage> {
  sandbox = billingSandbox(env, owner, sandbox);
  return {...await db(env, sandbox ? "rpc/sandbox_account_usage" : "rpc/account_usage", { p_owner: owner }),packsEnabled:sandbox || env.MINUTE_PACKS_ENABLED==='true'};
}
export function requireBillingTester(env: Env, owner: string) {
  if (!owner || ![env.BILLING_TEST_USER_IDS, env.APP_REVIEW_USER_IDS].some(ids => (ids || '').split(',').map(id=>id.trim()).includes(owner)))
    throw Object.assign(new Error('Sandbox purchases are not enabled for this account.'), {status:403});
}
/** Dedicated review accounts must exercise Apple's sandbox in the production
 * binary. Only server-configured account IDs select this mode; client metadata
 * and request flags cannot enroll a reviewer or grant production credit. */
export function billingSandbox(env: Env, owner: string, requested = false): boolean {
  const review = !!owner && (env.APP_REVIEW_USER_IDS || '').split(',').map(id=>id.trim()).includes(owner);
  if (review || requested) requireBillingTester(env, owner);
  return review || requested;
}
export async function refreshEntitlement(env: Env, owner: string, sandbox = false): Promise<SubscriptionSync> {
  sandbox = billingSandbox(env, owner, sandbox);
  if (!env.REVENUECAT_SECRET_KEY)
    throw new Error("Purchase verification is not configured.");
  const checked = new Date().toISOString();
  const r = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(owner)}`,
    {
      headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}` },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!r.ok) throw new Error("Could not verify purchases. Retry restoration.");
  const result = (await r.json()) as {
    subscriber: {
      original_app_user_id?: string;
      entitlements: Record<
        string,
        { expires_date?: string; purchase_date?: string; product_identifier?: string }
      >;
      subscriptions?: Record<string, {
        store_transaction_id?: string;
        store?: string;
        is_sandbox?: boolean;
        purchase_date?: string;
        expires_date?: string;
        refunded_at?: string | null;
      }>;
      non_subscriptions?: Record<string, Array<{
        id?: string;
        store_transaction_id?: string;
        is_sandbox?: boolean;
        refunded_at?: string | null;
        store?: string;
        purchase_date?: string;
      }>>;
    };
  };
  await synchronizePackPurchases(env, owner);
  await reconcilePackPurchases(env, owner, result.subscriber.non_subscriptions ?? {});
  let e: (typeof result.subscriber.entitlements)[string] | undefined = result.subscriber.entitlements[env.REVENUECAT_ENTITLEMENT];
  const proProducts = new Set(['AUDEEO_MONTHLY_1','audeeo_pro_yearly','audeeo_pro_monthly_web','audeeo_pro_yearly_web']);
  const subscriptions = Object.entries(result.subscriber.subscriptions ?? {});
  if (sandbox) {
    const test = subscriptions.filter(([id,s])=>proProducts.has(id) && s.is_sandbox === true && !s.refunded_at && Date.parse(s.expires_date || '') > Date.now())
      .sort((a,b)=>Date.parse(b[1].purchase_date || '')-Date.parse(a[1].purchase_date || ''))[0];
    const period = test?.[1].purchase_date && test[1].expires_date ? allowancePeriod(test[1].purchase_date,test[1].expires_date) : null;
    if (test && (!period || !test[1].store_transaction_id)) throw new Error('Test subscription verification is incomplete. Refresh purchases to retry.');
    await db(env,'rpc/apply_sandbox_entitlement',{p_owner:owner,p_active:!!test,p_product:test?.[0]??null,
      p_subscription:test?.[1].store_transaction_id??null,p_start:period?.start??null,p_end:period?.end??null,p_checked:checked});
    const usage = await accountUsage(env,owner,true);
    return {...usage,expiresAt:test?.[1].expires_date??null};
  }
  // A test receipt must never turn into a live subscription allowance. If
  // RevenueCat selects a sandbox entitlement, retain any other active live plan.
  if (e && result.subscriber.subscriptions?.[e.product_identifier || '']?.is_sandbox === true) {
    const live = subscriptions.find(([id,s])=>proProducts.has(id) && s.is_sandbox === false && !s.refunded_at && Date.parse(s.expires_date || '') > Date.now());
    e = live ? {product_identifier:live[0],purchase_date:live[1].purchase_date,expires_date:live[1].expires_date} : undefined;
  }
  const productId = e?.product_identifier?.trim() || null;
  const subscription = productId ? result.subscriber.subscriptions?.[productId] : undefined;
  const promotionalPurchase = productId
    ? [...(result.subscriber.non_subscriptions?.[productId] ?? [])]
        .sort((a, b) => Date.parse(b.purchase_date || "") - Date.parse(a.purchase_date || ""))[0]
    : undefined;
  // RevenueCat represents granted/promotional access as a non-subscription
  // transaction in v1. Its generated transaction ID is the durable billing
  // identity for that grant, equivalent to store_transaction_id for renewals.
  const subscriptionId = subscription?.store_transaction_id?.trim()
    || promotionalPurchase?.id?.trim()
    || null;
  const store = subscription?.store?.trim() || promotionalPurchase?.store?.trim() || null;
  const entitlementActive = !!e?.expires_date && Date.parse(e.expires_date) > Date.now();
  // Never turn a provider entitlement into paid usage unless it is traceable to
  // the concrete store subscription that produced it.
  if (entitlementActive && (!productId || !subscriptionId))
    throw new Error("RevenueCat returned an active entitlement without a subscription identifier.");
  const paid = entitlementActive && !!productId && !!subscriptionId;
  const period = paid && e?.purchase_date && e.expires_date
    ? allowancePeriod(e.purchase_date, e.expires_date) : null;
  await db(env, "rpc/apply_entitlement", {
    p_owner: owner,
    p_start: period?.start ?? e?.purchase_date ?? null,
    p_end: period?.end ?? e?.expires_date ?? null,
    p_checked: checked,
    p_paid: paid,
    p_revenuecat_customer_id: result.subscriber.original_app_user_id?.trim() || owner,
    p_subscription_id: subscriptionId,
    p_entitlement_id: env.REVENUECAT_ENTITLEMENT,
    p_product_id: productId,
    p_store: store,
  });
  return { ...(await accountUsage(env, owner)), expiresAt: e?.expires_date ?? null };
}

/** Only server-configured, authenticated user IDs can skip billing during development. */
export function isDevelopmentUser(env: Pick<Env, "DEV_USER_IDS">, userId: string): boolean {
  return !!userId && (env.DEV_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}
