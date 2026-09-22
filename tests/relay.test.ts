import { describe, it, expect, vi, afterEach } from "vitest";
import relay from "../services/session-relay/src/index";
import { accountUsage, db, refreshEntitlement, allowancePeriod, isDevelopmentUser } from "../services/session-relay/src/backend";
const env: any = {
  ALLOWED_ORIGINS: "http://localhost:1420",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  REVENUECAT_SECRET_KEY: "secret",
  REVENUECAT_ENTITLEMENT: "audeeo_pro",
  REVENUECAT_WEBHOOK_AUTH_KEY: "Bearer webhook",
};
afterEach(() => vi.unstubAllGlobals());
describe("relay authorization", () => {
  it("refuses unapproved browser origins", async () => {
    const r = await relay.fetch(
      new Request("https://relay.test/v1/realtime", {
        headers: { Origin: "https://attacker.test" },
      }),
      env,
    );
    expect(r.status).toBe(403);
  });
  it("does not accept unauthenticated billing webhooks", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const r = await relay.fetch(
      new Request("https://relay.test/v1/billing/webhook", {
        method: "POST",
        body: "{}",
      }),
      env,
    );
    expect(r.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed when provider configuration is absent", async () => {
    const r = await relay.fetch(
      new Request("https://relay.test/v1/realtime", {
        headers: { Upgrade: "websocket" },
      }),
      env,
    );
    expect(r.status).toBe(503);
  });
  it("does not grant allowance from client purchase success assertions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const r = await relay.fetch(
      new Request("https://relay.test/v1/purchases/restore", {
        method: "POST",
        headers: { Authorization: "Bearer fake" },
        body: JSON.stringify({ active: true }),
      }),
      env,
    );
    expect(r.status).toBe(503);
  });
  it("reconciles restoration using authoritative RevenueCat state", async () => {
    const calls: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url, options });
        if (String(url).includes("revenuecat")) return Response.json({
              subscriber: {
                original_app_user_id: "rc-owner",
                entitlements: {
                  audeeo_pro: {
                    expires_date: "2099-01-01T00:00:00Z",
                    purchase_date: "2026-09-01T00:00:00Z",
                    product_identifier: "audeeo_yearly",
                  },
                },
                subscriptions: {
                  audeeo_yearly: {
                    store_transaction_id: "sub_123",
                    store: "stripe",
                  },
                },
              },
            });
        if (String(url).includes("rpc/account_usage")) return Response.json({
          active: true,
          unlimited: false,
          usedSeconds: 15,
          includedSeconds: 36000,
          remainingSeconds: 35985,
          periodStart: "2026-09-01T00:00:00Z",
          periodEnd: "2026-10-01T00:00:00Z",
          subscription: { id: "sub_123" },
        });
        return Response.json(null);
      }),
    );
    const r = await refreshEntitlement(env, "owner");
    expect(r.active).toBe(true);
    const body = JSON.parse(calls[1].options.body);
    expect(body.p_owner).toBe("owner");
    expect(body.p_paid).toBe(true);
    expect(body.p_revenuecat_customer_id).toBe("rc-owner");
    expect(body.p_subscription_id).toBe("sub_123");
    expect(body.p_product_id).toBe("audeeo_yearly");
    expect(body.p_store).toBe("stripe");
    expect(body.p_start).toBe(allowancePeriod("2026-09-01T00:00:00Z", "2099-01-01T00:00:00Z").start);
    expect(r.usedSeconds).toBe(15);
  });

  it("does not grant paid usage when RevenueCat omits the store subscription id", async () => {
    const fetch = vi.fn(async () => Response.json({
      subscriber: {
        entitlements: { audeeo_pro: {
          expires_date: "2099-01-01T00:00:00Z",
          purchase_date: "2026-09-01T00:00:00Z",
          product_identifier: "audeeo_yearly",
        } },
        subscriptions: { audeeo_yearly: { store: "stripe" } },
      },
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(refreshEntitlement(env, "owner")).rejects.toThrow("without a subscription identifier");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("persists RevenueCat's transaction id for a promotional yearly grant", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      calls.push({ url, options });
      if (String(url).includes("revenuecat")) return Response.json({ subscriber: {
        original_app_user_id: "owner",
        entitlements: { audeeo_pro: {
          expires_date: "2099-01-01T00:00:00Z",
          purchase_date: "2026-09-15T00:00:00Z",
          product_identifier: "rc_promo_yearly",
        } },
        subscriptions: {},
        non_subscriptions: { rc_promo_yearly: [{
          id: "promo_transaction_123",
          store: "promotional",
          purchase_date: "2026-09-15T00:00:00Z",
        }] },
      } });
      if (String(url).includes("rpc/account_usage")) return Response.json({
        active: true, unlimited: false, usedSeconds: 0, includedSeconds: 36000,
        remainingSeconds: 36000, periodStart: null, periodEnd: null, subscription: null,
      });
      return Response.json(null);
    }));
    await refreshEntitlement(env, "owner");
    const body = JSON.parse(calls[1].options.body);
    expect(body.p_subscription_id).toBe("promo_transaction_123");
    expect(body.p_product_id).toBe("rc_promo_yearly");
    expect(body.p_store).toBe("promotional");
    expect(body.p_paid).toBe(true);
  });
});

it("loads usage only through the service-side account RPC", async () => {
  const fetch = vi.fn(async () => Response.json({ usedSeconds: 45 }));
  vi.stubGlobal("fetch", fetch);
  await expect(accountUsage(env, "owner")).resolves.toMatchObject({ usedSeconds: 45 });
  expect(fetch.mock.calls[0][0]).toBe(`${env.SUPABASE_URL}/rest/v1/rpc/account_usage`);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ p_owner: "owner" });
});

it("returns only the signed-in user's account usage", async () => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const token = `header.${btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
  const fetch = vi.fn(async (url: unknown) => String(url).includes("/auth/v1/user")
    ? Response.json({ id: owner })
    : Response.json({ active: true, usedSeconds: 75, remainingSeconds: 125 }));
  vi.stubGlobal("fetch", fetch);
  const response = await relay.fetch(new Request("https://relay.test/v1/account/usage", {
    headers: { Authorization: `Bearer ${token}` },
  }), env);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ usedSeconds: 75 });
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ p_owner: owner });
});

it("uses the secret API key without bearer authorization for database requests", async () => {
  const fetch = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json([]));
  vi.stubGlobal("fetch", fetch);
  await db(env, "rpc/reserve_usage", { p_seconds: 15 });
  const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(headers.get("apikey")).toBe(env.SUPABASE_SECRET_KEY);
  expect(headers.has("Authorization")).toBe(false);
});

it("validates the user JWT with the publishable key before deleting via the secret key", async () => {
  const owner = "00000000-0000-0000-0000-000000000001";
  const token = `header.${btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
  const fetch = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json({ id: owner }));
  vi.stubGlobal("fetch", fetch);
  const response = await relay.fetch(new Request("https://relay.test/v1/account", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }), env);
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(fetch.mock.calls[0][0]).toBe(`${env.SUPABASE_URL}/auth/v1/user`);
  const userHeaders = new Headers(fetch.mock.calls[0][1]?.headers);
  expect(userHeaders.get("apikey")).toBe(env.SUPABASE_PUBLISHABLE_KEY);
  expect(userHeaders.get("Authorization")).toBe(`Bearer ${token}`);
  const deletion = fetch.mock.calls.find(([url,options])=>url === `${env.SUPABASE_URL}/auth/v1/admin/users/${owner}` && options?.method === "DELETE")!;
  expect(deletion).toBeTruthy();
  const adminHeaders = new Headers(deletion[1]?.headers);
  expect(adminHeaders.get("apikey")).toBe(env.SUPABASE_SECRET_KEY);
  expect(adminHeaders.has("Authorization")).toBe(false);
});

it("renews annual-plan minutes monthly and clamps month-end anniversaries", () => {
  expect(allowancePeriod("2026-01-31T10:30:00Z", "2027-01-31T10:30:00Z", new Date("2026-03-01")))
    .toEqual({ start: "2026-02-28T10:30:00.000Z", end: "2026-03-31T10:30:00.000Z" });
  expect(allowancePeriod("2026-09-12T10:00:00Z", "2026-09-19T10:00:00Z", new Date("2026-09-13")))
    .toEqual({ start: "2026-09-12T10:00:00.000Z", end: "2026-09-19T10:00:00.000Z" });
});

it('acknowledges authenticated dashboard tests without purchase verification or database writes', async () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 const r = await relay.fetch(new Request('https://relay.test/v1/billing/webhook', {
  method: 'POST', headers: { Authorization: env.REVENUECAT_WEBHOOK_AUTH_KEY },
  body: JSON.stringify({event:{id:'dashboard-test',type:'TEST',app_user_id:'00000000-0000-4000-8000-000000000001'}}),
 }), {...env,REVENUECAT_SECRET_KEY:''});
 expect(r.status).toBe(200); expect(fetch).not.toHaveBeenCalled();
});
it('still rejects unauthenticated dashboard tests', async () => {
 const r = await relay.fetch(new Request('https://relay.test/v1/billing/webhook', {
  method:'POST',body:JSON.stringify({event:{id:'test',type:'TEST'}}),
 }),env); expect(r.status).toBe(401);
});

it('only exempts explicitly allowlisted authenticated development accounts', () => {
 expect(isDevelopmentUser({}, 'user')).toBe(false);
 expect(isDevelopmentUser({DEV_USER_IDS: ' dev-user, other '}, 'dev-user')).toBe(true);
 expect(isDevelopmentUser({DEV_USER_IDS: 'dev-user'}, 'user')).toBe(false);
 expect(isDevelopmentUser({DEV_USER_IDS: '*'}, 'user')).toBe(false);
 expect(isDevelopmentUser({DEV_USER_IDS: ''}, '')).toBe(false);
});
it('sets ArrayBuffer delivery before accepting binary audio', async () => {
 let observed: string | undefined;
 vi.stubGlobal('WebSocketPair', class {
  0 = {};
  1 = { binaryType: 'blob', accept() { observed = this.binaryType; throw new Error('stop before opening test socket'); } };
 });
 await relay.fetch(new Request('https://relay.test/v1/realtime', {headers:{Upgrade:'websocket'}}), {...env,OPENAI_API_KEY:'test'});
 expect(observed).toBe('arraybuffer');
});

it('confirms a pack only after the requested quantity is credited',async()=>{
 let quantity=1;
 vi.stubGlobal('fetch',vi.fn(async(url)=>Response.json(String(url).includes('/auth/v1/user')?{id:'11111111-1111-4111-8111-111111111111'}:[{environment:'PRODUCTION',refunded_at:null,quantity}])));
 const request=()=>new Request('https://relay.test/v1/purchases/status?transaction=tx&product=audeeo_minutes_60&quantity=3',{headers:{Authorization:`Bearer e30.${btoa(JSON.stringify({sub:'11111111-1111-4111-8111-111111111111',exp:Math.floor(Date.now()/1000)+600}))}.sig`}});
 expect(await (await relay.fetch(request(),env)).json()).toEqual({status:'pending'});
 quantity=3;
 expect(await (await relay.fetch(request(),env)).json()).toEqual({status:'confirmed',environment:'PRODUCTION'});
});
