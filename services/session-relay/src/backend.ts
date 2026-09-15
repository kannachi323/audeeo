import type { AccountUsage, SubscriptionSync } from "../../../shared/billing";

export interface Env {
  DEV_USER_IDS?: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  OPENAI_API_KEY?: string;
  SUMMARY_MODEL?: string;
  SONIOX_API_KEY?: string;
  SONIOX_MODEL?: string;
  CAPTION_PROVIDER?: string;
  REVENUECAT_SECRET_KEY: string;
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
): Promise<{ id: string; expiresAt: number }> {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("Sign in again to continue.");
  const user = (await r.json()) as { id: string };
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
export async function accountUsage(env: Env, owner: string): Promise<AccountUsage> {
  return db(env, "rpc/account_usage", { p_owner: owner });
}
export async function refreshEntitlement(env: Env, owner: string): Promise<SubscriptionSync> {
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
      }>;
      non_subscriptions?: Record<string, Array<{
        id?: string;
        store?: string;
        purchase_date?: string;
      }>>;
    };
  };
  const e = result.subscriber.entitlements[env.REVENUECAT_ENTITLEMENT];
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
