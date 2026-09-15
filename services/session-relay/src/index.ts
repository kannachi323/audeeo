import {validLanguagePair} from "../../../shared/languages";
import type { Language } from "../../../shared/pipeline";
import { AudioEncoder, OpenAICaptions, sessionConfig } from "./openai";
import { SonioxBackend } from "./soniox";
import { SilenceGuard } from "./silence";
import { connectUpstream } from "./connect";
import { accountUsage, db, identity, refreshEntitlement, isDevelopmentUser, type Env } from "./backend";
import { sessionContext, type SessionContext } from "../../../shared/context";
import { answerQuestion, contextFromLink, generateSummary } from "./intelligence";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default {
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
        "authorization,content-type",
      );
      r.headers.set("Access-Control-Allow-Methods", "POST,DELETE,GET,OPTIONS");
      return r;
    };
    if (request.method === "OPTIONS") return respond({});
    if (url.pathname === "/health") return respond({ ok: true });
    try {
      if (url.pathname === "/v1/billing/webhook" && request.method === "POST") {
        if (
          !env.REVENUECAT_WEBHOOK_AUTH_KEY ||
          request.headers.get("Authorization") !== env.REVENUECAT_WEBHOOK_AUTH_KEY
        )
          return respond({ error: "Unauthorized" }, 401);
        const { event } = (await request.json()) as {
          event: {
            id: string;
            app_user_id: string;
            type: string;
            original_app_user_id?: string;
            aliases?: string[];
            transferred_from?: string[];
            transferred_to?: string[];
          };
        };
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
        const owners = [
          ...new Set([
            event.app_user_id,
            event.original_app_user_id ?? "",
            ...(event.aliases ?? []),
            ...(event.transferred_from ?? []),
            ...(event.transferred_to ?? []),
          ]),
        ].filter((id) => uuid.test(id));
        for (const owner of owners) await refreshEntitlement(env, owner);
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
      if (
        url.pathname === "/v1/purchases/restore" &&
        request.method === "POST"
      ) {
        const user = await identity(
          env,
          (request.headers.get("Authorization") || "").replace(/^Bearer /, ""),
        );
        return respond(await refreshEntitlement(env, user.id));
      }
      if (url.pathname === "/v1/account/usage" && request.method === "GET") {
        const user = await identity(
          env,
          (request.headers.get("Authorization") || "").replace(/^Bearer /, ""),
        );
        return respond(await accountUsage(env, user.id));
      }
      if (url.pathname === "/v1/account" && request.method === "DELETE") {
        const user = await identity(
          env,
          (request.headers.get("Authorization") || "").replace(/^Bearer /, ""),
        );
        const r = await fetch(
          `${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
          {
            method: "DELETE",
            headers: {
              apikey: env.SUPABASE_SECRET_KEY,
            },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!r.ok) throw new Error("Account deletion failed. Retry.");
        return respond({ deleted: true });
      }
      const summaryMatch = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)\/summary$/i);
      const questionMatch = url.pathname.match(/^\/v1\/sessions\/([0-9a-f-]+)\/questions$/i);
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
      if (!["/v1/realtime", "/v1/realtime/soniox", "/v1/realtime/openai"].includes(url.pathname))
        return respond({ error: "Not found" }, 404);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return respond({ error: "WebSocket required" }, 426);
      const routeProvider = url.pathname === '/v1/realtime/soniox' ? 'soniox'
        : url.pathname === '/v1/realtime/openai' ? 'openai' : (env.CAPTION_PROVIDER || 'soniox');
      if (!['openai', 'soniox'].includes(routeProvider)) return respond({ error: 'Unknown caption provider' }, 503);
      if (!env.SUPABASE_SECRET_KEY)
        return respond({ error: "Service is not configured" }, 503);
      const pair = new WebSocketPair();
      const [client, socket] = Object.values(pair);
      socket.binaryType = "arraybuffer";
      socket.accept();
      let upstream: WebSocket | undefined,
        captions: OpenAICaptions | undefined;
      let soniox: SonioxBackend | undefined;
      const encoder = new AudioEncoder();
      let translating = false;
      let silence: SilenceGuard | undefined;
      let silenceTick: ReturnType<typeof setInterval> | undefined;
      let stopItem: string | undefined;
      const completedItems = new Set<string>();
      let started = false,
        closed = false,
        stopping = false,
        finishing = false,
        reservation = 0,
        paidSeconds = 0,
        audioBytes = 0,
        startedAt = 0;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      let expiryTimer: ReturnType<typeof setTimeout> | undefined,
        tick: ReturnType<typeof setInterval> | undefined;
      let metering = false;
      const sessionId = crypto.randomUUID();
      const send = (data: unknown) => {
        if (!closed)
          try {
            socket.send(JSON.stringify(data));
          } catch {}
      };
      const error = (message: string) => send({ type: "error", message });
      const cleanup = () => {
        clearTimeout(drainTimer);
        clearInterval(silenceTick);
        clearTimeout(expiryTimer);
        clearInterval(tick);
        clearTimeout(authTimer);
      };
      const close = async (reason: string) => {
        if (stopping) return;
        stopping = true;
        // Keep diagnostics free of audio, transcripts, tokens, and account data.
        console.info('Caption session ended', { reason, audioSeconds: audioBytes / 32000 });
        if (!finishing && (reason === 'provider closed' || reason === 'network loss'))
          error('The caption provider connection ended unexpectedly. Start again to reconnect.');
        cleanup();
        try {
          upstream?.close(1000, "Session ended");
          soniox?.close();
        } catch {}
        captions?.flush();
        soniox?.captions.flush();
        send({ type: "finished", reason });
        closed = true;
        try {
          socket.close(1000, "Session ended");
        } catch {}
      };
      const authTimer = setTimeout(() => {
        error("Sign in to start captions.");
        void close("authentication timeout");
      }, 10000);
      socket.addEventListener("message", async (event) => {
        try {
          if (closed || stopping) return;
          if (!started) {
            started = true;
            clearTimeout(authTimer);
            if (typeof event.data !== "string" || event.data.length > 20000)
              throw new Error("Invalid session request");
            const config = JSON.parse(event.data) as {
              type: string;
              accessToken: string;
              sourceLanguage: Language;
              targetLanguage: Language;
              silence?: unknown;
              provider?: "openai" | "soniox";
              providerKey?: string;
              context?: SessionContext;
            };
            if (
              config.type !== "start" ||
              !validLanguagePair(config.sourceLanguage, config.targetLanguage)
            )
              throw new Error(
                "Choose a supported source and target language.",
              );
            const user = await identity(env, config.accessToken);
            const ownKey = typeof config.providerKey === "string" ? config.providerKey.trim() : "";
            const context = sessionContext(config.context ?? {category:"general",text:"",terms:[],translationTerms:[]});
            if (ownKey.length > 512) throw new Error("Invalid provider key.");
            const provider = ownKey ? config.provider : routeProvider;
            if (!provider || !["openai", "soniox"].includes(provider))
              throw new Error("Choose a supported caption provider.");
            const providerKey = ownKey || (provider === "soniox" ? env.SONIOX_API_KEY : env.OPENAI_API_KEY) || "";
            if (!providerKey) throw new Error("Caption provider is not configured.");
            // Reconcile renewals, refunds, and monthly allowances on annual plans
            // before allocating server-metered audio. Client flags never grant minutes.
            const development = isDevelopmentUser(env, user.id);
            const userFunded = !!ownKey;
            if (!development && !userFunded && env.REVENUECAT_SECRET_KEY) await refreshEntitlement(env, user.id);
            if (stopping) return;
            const reserve = async () =>
              development || userFunded ? 15 : Number(
                await db(env, "rpc/reserve_usage", {
                  p_owner: user.id,
                  p_session: sessionId,
                  p_reservation: reservation++,
                  p_seconds: 15,
                }),
              );
            paidSeconds = await reserve();
            if (!paidSeconds)
              throw new Error(
                "Your allowance is exhausted. Restore purchases or check your subscription.",
              );
            translating = config.sourceLanguage !== config.targetLanguage;
            if (provider === 'soniox') {
              soniox = new SonioxBackend(providerKey, sessionId, config.sourceLanguage, config.targetLanguage,
                segment => send({type: 'segment', segment}),
                message => { error(message); void close('provider error'); },
                () => void close('finished'), env.SONIOX_MODEL, context);
              await soniox.connect();
              if (stopping) { soniox.close(); return; }
            } else {
              const endpoint = translating
                ? 'https://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate'
                : 'https://api.openai.com/v1/realtime?intent=transcription';
              const r = await connectUpstream(endpoint, providerKey);
              upstream = r.webSocket ?? undefined;
              if (!upstream || r.status !== 101) throw new Error('OpenAI could not connect. Check the server API key and model access.');
              if (stopping) { upstream.close(); return; }
              upstream.accept();
              captions = new OpenAICaptions(sessionId, config.sourceLanguage, config.targetLanguage, segment => send({ type: 'segment', segment }));
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('OpenAI session configuration timed out.')), 10000);
                upstream!.addEventListener('message', e => {
                  if (typeof e.data !== 'string') return;
                  try {
                    const raw = JSON.parse(e.data);
                    if (raw.type === 'input_audio_buffer.committed' && finishing) stopItem = raw.item_id;
                    if (raw.type === 'conversation.item.input_audio_transcription.completed') completedItems.add(raw.item_id);
                    if (completedItems.size > 256) completedItems.delete(completedItems.values().next().value!);
                    if (finishing && raw.type === 'error' && raw.error?.code === 'input_audio_buffer_commit_empty') { void close('finished'); return; }
                    if (raw.type === 'session.updated') { clearTimeout(timeout); resolve(); }
                    if (raw.type === 'error' || raw.type === 'conversation.item.input_audio_transcription.failed') {
                      clearTimeout(timeout); reject(new Error('OpenAI session failed. Check configuration and retry.'));
                      error('OpenAI caption session failed.'); void close('provider error'); return;
                    }
                    if (translating && raw.type === 'session.output_audio.delta') {
                      if (typeof raw.delta !== 'string' || raw.delta.length > 256000 ||
                          (raw.sample_rate != null && raw.sample_rate !== 24000) ||
                          (raw.channels != null && raw.channels !== 1) ||
                          (raw.format != null && raw.format !== 'pcm16')) {
                        error('Unsupported translated audio format. Restart the session.'); void close('audio format'); return;
                      }
                      send({ type: 'audio', pcm: raw.delta, sampleRate: 24000 });
                    }
                    captions?.ingest(raw, Math.max(0, Date.now() - startedAt));
                    if (raw.type === 'session.closed' || (finishing && stopItem && completedItems.has(stopItem))) void close('finished');
                  } catch { error('An unreadable caption was received.'); }
                });
                upstream!.addEventListener('close', () => { clearTimeout(timeout); reject(new Error('OpenAI connection closed.')); void close('provider closed'); });
                upstream!.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('OpenAI connection failed.')); void close('network loss'); });
                upstream!.send(JSON.stringify(sessionConfig(config.sourceLanguage, config.targetLanguage)));
              });
            }
            if (stopping) return;
            startedAt = Date.now();
            silence = new SilenceGuard(startedAt, config.silence);
            // Independent of metering awaits, provider events, and client timers.
            silenceTick = setInterval(() => {
              if (!stopping && !finishing && silence?.expired(Date.now()))
                void close("silence timeout");
            }, 250);
            const maxSeconds = Math.min(
              14400,
              Math.max(15, Number(env.MAX_SESSION_SECONDS) || 1800),
            );
            expiryTimer = setTimeout(
              () => {
                error(
                  "Session limit or sign-in expiry reached. Start a new session.",
                );
                void close("limit");
              },
              Math.min(maxSeconds * 1000, user.expiresAt - Date.now()),
            );
            tick = setInterval(async () => {
              if (stopping || metering) return;
              metering = true;
              try {
                const elapsed = (Date.now() - startedAt) / 1000;
                if (elapsed >= paidSeconds) {
                  error(
                    "Allowance reached. Start a new session after checking your subscription.",
                  );
                  void close("allowance");
                  return;
                }
                if (paidSeconds - elapsed < 5) {
                  const extra = await reserve();
                  if (stopping) return;
                  paidSeconds += extra;
                  if (!extra) {
                    error("Allowance exhausted.");
                    void close("allowance");
                    return;
                  }
                }

              } catch {
                error("Usage verification unavailable. Reconnect when online.");
                void close("metering unavailable");
              } finally {
                metering = false;
              }
            }, 1000);
            send({ type: "ready", sessionId });
            return;
          }
          if ((!upstream && !soniox) || !startedAt)
            throw new Error("Wait for the session to connect.");
          if (typeof event.data === "string") {
            if (event.data.length > 1000)
              throw new Error("Invalid control message");
            if (JSON.parse(event.data).type !== "stop")
              throw new Error("Unsupported control message");
            if (finishing) return;
            finishing = true;
            clearInterval(tick);
            if (soniox) void soniox.finish().catch(() => {
              if (!stopping) { error('Soniox finalization failed; output may be incomplete.'); void close('provider error'); }
            });
            else upstream!.send(JSON.stringify({ type: translating ? "session.close" : "input_audio_buffer.commit" }));
            drainTimer = setTimeout(() => { error("Provider finalization timed out; output may be incomplete."); void close("stop timeout"); }, 15000);
          } else {
            if (finishing) return;
            const audio = event.data;
            // Reject unexpected payload types before decoding or metering.
            if (!(audio instanceof ArrayBuffer) && !ArrayBuffer.isView(audio))
              throw new Error("Unsupported audio buffer. Reconnect to continue.");
            const bytes = audio.byteLength;
            const elapsed = (Date.now() - startedAt) / 1000;
            if (
              bytes > 32768 ||
              bytes % 2 ||
              audioBytes + bytes > Math.min(paidSeconds, elapsed + 2) * 32000
            )
              throw new Error(
                "Audio stream exceeded its permitted rate. Reconnect.",
              );
            // Check before observing: a late packet cannot revive an expired session.
            if (silence?.expired(Date.now())) { void close("silence timeout"); return; }
            silence?.observe(audio, Date.now());
            audioBytes += bytes;
            if (soniox) soniox.sendAudio(audio);
            else upstream!.send(JSON.stringify({ type: translating ? "session.input_audio_buffer.append" : "input_audio_buffer.append", audio: encoder.encode(audio) }));
          }
        } catch (e) {
          error(e instanceof Error ? e.message : "Session failed. Retry.");
          void close("error");
        }
      });
      socket.addEventListener("close", () => void close("client disconnected"));
      socket.addEventListener(
        "error",
        () => void close("client connection lost"),
      );
      return new Response(null, { status: 101, webSocket: client });
    } catch (e) {
      return respond(
        { error: e instanceof Error ? e.message : "Service unavailable" },
        typeof (e as any)?.status === "number" ? (e as any).status : 503,
      );
    }
  },
} satisfies ExportedHandler<Env>;
