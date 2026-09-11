import { describe, it, expect, vi, afterEach } from "vitest";
import relay from "../services/session-relay/src/index";
import { db, refreshEntitlement, allowancePeriod, isDevelopmentUser } from "../services/session-relay/src/backend";
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
        return String(url).includes("revenuecat")
          ? Response.json({
              subscriber: {
                entitlements: {
                  audeeo_pro: {
                    expires_date: "2099-01-01T00:00:00Z",
                    purchase_date: "2026-09-01T00:00:00Z",
                  },
                },
              },
            })
          : Response.json(null);
      }),
    );
    const r = await refreshEntitlement(env, "owner");
    expect(r.active).toBe(true);
    const body = JSON.parse(calls[1].options.body);
    expect(body.p_owner).toBe("owner");
    expect(body.p_paid).toBe(true);
    expect(body.p_start).toBe(allowancePeriod("2026-09-01T00:00:00Z", "2099-01-01T00:00:00Z").start);
  });
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
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0]).toBe(`${env.SUPABASE_URL}/auth/v1/user`);
  const userHeaders = new Headers(fetch.mock.calls[0][1]?.headers);
  expect(userHeaders.get("apikey")).toBe(env.SUPABASE_PUBLISHABLE_KEY);
  expect(userHeaders.get("Authorization")).toBe(`Bearer ${token}`);
  expect(fetch.mock.calls[1][0]).toBe(`${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`);
  const adminHeaders = new Headers(fetch.mock.calls[1][1]?.headers);
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
