import {isMinutePackProduct} from '../../../shared/minutePacks';
import {applyPackEvent,type PurchaseEvent} from "./packs";
import {liveSession} from "./liveSession";
import {deleteAccount} from "./accountDeletion";
import {MAX_SCREENSHOT_REQUEST_BYTES} from "../../../shared/contextScreenshot";
import { accountUsage, billingSandbox, db, identity, refreshEntitlement, type Env } from "./backend";
import { answerQuestion, contextFromLink, contextFromScreenshot, generateSummary } from "./intelligence";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default {
  async scheduled(_event: ScheduledController, env: Env) {
    const count=await db(env,"rpc/reconcile_usage_leases",{});
    if(count)console.info(JSON.stringify({event:'usage_leases_reconciled',count}));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
    if (origin && !allowed.includes(origin))
      return json({ error: "Origin not allowed" }, 403);
    const respond = (body: unknown, status = 200) => {
      const r = json(body, status);
      if (origin) {
        r.headers.set("Access-Control-Allow-Origin", origin);
        r.headers.set("Vary", "Origin");
      }
      r.headers.set(
        "Access-Control-Allow-Headers",
        "authorization,content-type,x-audeeo-billing-environment",
      );
      r.headers.set("Access-Control-Allow-Methods", "POST,DELETE,GET,OPTIONS");
      return r;
    };
    if (request.method === "OPTIONS") return respond({});
    if (url.pathname === "/health") return respond({ ok: true });
    if (url.pathname === "/v1/release-readiness" && request.method === "GET") {
      let appleRevocationConfigured = false;
      try {
        const claims = JSON.parse(atob((env.APPLE_CLIENT_SECRET || "").split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
        appleRevocationConfigured = !!env.APPLE_CLIENT_ID && claims.sub === env.APPLE_CLIENT_ID && claims.exp * 1000 > Date.now() + 86400000;
      } catch { /* Missing or expired configuration keeps release checks closed. */ }
      return respond({ready:appleRevocationConfigured && !!env.REVENUECAT_SECRET_KEY,
        appleRevocationConfigured,billingDeletionConfigured:!!env.REVENUECAT_SECRET_KEY,packRecoveryConfigured:!!env.REVENUECAT_V2_SECRET_KEY && !!env.REVENUECAT_PROJECT_ID,minutePacksEnabled:env.MINUTE_PACKS_ENABLED==='true'});
    }
    try {
      if (url.pathname === "/v1/billing/webhook" && request.method === "POST") {
        if (
          !env.REVENUECAT_WEBHOOK_AUTH_KEY ||
          request.headers.get("Authorization") !== env.REVENUECAT_WEBHOOK_AUTH_KEY
        )
          return respond({ error: "Unauthorized" }, 401);
        const {event}=await request.json() as {event:PurchaseEvent};
        if (typeof event?.id !== "string" || !event.id || event.id.length > 256)
          return respond({ error: "Invalid event" }, 400);
        // Dashboard TEST events verify delivery, not a real subscription.
        if (event.type === "TEST") return respond({ ok: true });
        const existing = await db(
          env,
          `billing_webhook_events?id=eq.${encodeURIComponent(event.id)}&select=id`,
          undefined,
          "GET",
        );
        if (existing.length) return respond({ ok: true });
        const packEvent = await applyPackEvent(env,event);
        const owners = [
          ...new Set([
            event.app_user_id,
            event.original_app_user_id ?? "",
            ...(event.aliases ?? []),
            ...(event.transferred_from ?? []),
            ...(event.transferred_to ?? []),
          ]),
        ].filter((id) => uuid.test(id));
        if (!packEvent) for (const owner of owners) await refreshEntitlement(env, owner);
        // Insert after reconciliation: failed events remain retryable. Concurrent duplicates are harmless.
        await db(
          env,
          "billing_webhook_events?on_conflict=id",
          { id: event.id },
          "POST",
        ).catch(async () => {
          const rows = await db(
            env,
            `billing_webhook_events?id=eq.${encodeURIComponent(event.id)}&select=id`,
            undefined,
            "GET",
          );
          if (!rows.length) throw new Error("Webhook persistence failed");
        });
        return respond({ ok: true });
      }
      if(url.pathname === '/v1/purchases/status' && request.method === 'GET') {
        const user=await identity(env,(request.headers.get('Authorization')||'').replace(/^Bearer /,''));
        const sandbox=billingSandbox(env,user.id,request.headers.get('X-Audeeo-Billing-Environment')==='sandbox');
        const transaction=url.searchParams.get('transaction'),product=url.searchParams.get('product'),after=url.searchParams.get('after');
        if((!transaction && !/^\d{1,16}$/.test(after||'')) || (transaction?.length??0)>512 || !isMinutePackProduct(product))return respond({error:'Invalid purchase'},400);
        const quantity=Number(url.searchParams.get('quantity')??1);
        if(!Number.isInteger(quantity)||quantity<1||quantity>10)return respond({error:'Invalid quantity'},400);
        const rows=await db(env,`minute_pack_purchases?owner_id=eq.${user.id}&environment=eq.${sandbox?'SANDBOX':'PRODUCTION'}&${transaction?`transaction_id=eq.${encodeURIComponent(transaction)}`:`id=gt.${after}`}&product_id=eq.${encodeURIComponent(product!)}&select=environment,refunded_at,quantity`,undefined,'GET');
        const row=rows.find((item:any)=>item.refunded_at||(item.quantity??1)>=quantity);return respond(row?{status:row.refunded_at?'refunded':'confirmed',environment:row.environment}:{status:'pending'});
      }
      if (
        url.pathname === "/v1/purchases/restore" &&
        request.method === "POST"
      ) {
        const user = await identity(
          env,
          (request.headers.get("Authorization") || "").replace(/^Bearer /, ""),
        );
        return respond(await refreshEntitlement(env, user.id, request.headers.get('X-Audeeo-Billing-Environment')==='sandbox'));
      }
      if (url.pathname === "/v1/account/usage" && request.method === "GET") {
        const user = await identity(
          env,
          (request.headers.get("Authorization") || "").replace(/^Bearer /, ""),
        );
        return respond(await accountUsage(env, user.id, request.headers.get('X-Audeeo-Billing-Environment')==='sandbox'));
      }
      if (url.pathname === "/v1/account" && request.method === "DELETE") {
        const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
        const user = await identity(env, token, true);
        // Bound the body before parsing; no provider credentials are logged.
        const reader = request.body?.getReader();
        let raw = "", size = 0;
        if (reader) {
          const decoder = new TextDecoder();
          try { for (;;) {
            const {value,done} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 12000) { await reader.cancel(); return respond({error:"Request too large."},413); }
            raw += decoder.decode(value,{stream:true});
          } raw += decoder.decode(); } finally { reader.releaseLock(); }
        }
        let body: {appleRefreshToken?:unknown} = {};
        try {body=raw ? JSON.parse(raw) : {}; if (!body || typeof body !== "object") throw new Error();}
        catch {return respond({error:"Invalid deletion request."},400);}
        return respond(await deleteAccount(env,user.id,token,body.appleRefreshToken));
      }
      const summaryMatch = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)\/summary$/i);
      const questionMatch = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)\/questions$/i);
      if (url.pathname === "/v1/context/from-screenshot" && request.method === "POST") {
        const user = await identity(env, (request.headers.get("Authorization") || "").replace(/^Bearer /, ""));
        if (Number(request.headers.get("content-length") || 0) > MAX_SCREENSHOT_REQUEST_BYTES)
          return respond({error:"Screenshot is too large."}, 413);
        const reader = request.body?.getReader();
        if (!reader) return respond({error:"Choose a screenshot."}, 400);
        let size = 0, raw = "";
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_SCREENSHOT_REQUEST_BYTES) {
              await reader.cancel();
              return respond({error:"Screenshot is too large."}, 413);
            }
            raw += decoder.decode(value, {stream:true});
          }
          raw += decoder.decode();
        } finally { reader.releaseLock(); }
        let body: unknown;
        try { body = JSON.parse(raw); } catch { return respond({error:"Invalid request."}, 400); }
        return respond(await contextFromScreenshot(env, user.id, body));
      }
      if (url.pathname === "/v1/context/from-link" && request.method === "POST") {
        const user = await identity(env, (request.headers.get("Authorization") || "").replace(/^Bearer /, ""));
        const raw = await request.text();
        if (raw.length > 4096) return respond({ error: "Request is too large." }, 413);
        let body: unknown;
        try { body = JSON.parse(raw); } catch { return respond({ error: "Invalid request." }, 400); }
        return respond(await contextFromLink(env, user.id, body));
      }
      if (request.method === "POST" && (summaryMatch || questionMatch)) {
        const id = (summaryMatch || questionMatch)![1];
        if (!uuid.test(id)) return respond({ error: "Invalid session." }, 400);
        const user = await identity(env, (request.headers.get("Authorization") || "").replace(/^Bearer /, ""));
        if (Number(request.headers.get("content-length") || 0) > 4096)
          return respond({ error: "Request is too large." }, 413);
        let body: unknown;
        try {
          const raw = await request.text();
          if (raw.length > 4096) return respond({ error: "Request is too large." }, 413);
          body = JSON.parse(raw);
        }
        catch { return respond({ error: "Invalid request." }, 400); }
        return respond(summaryMatch
          ? await generateSummary(env, user.id, id, body)
          : await answerQuestion(env, user.id, id, body));
      }
      if (url.pathname !== '/v1/realtime') return respond({error:'Not found'},404);
      if (request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return respond({error:'WebSocket required'},426);
      return liveSession(env);
    } catch (e) {
      return respond(
        { error: e instanceof Error ? e.message : "Service unavailable" },
        typeof (e as any)?.status === "number" ? (e as any).status : 503,
      );
    }
  },
} satisfies ExportedHandler<Env>;
