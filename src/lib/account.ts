import { config } from "./config";
import { createClient, type Session } from "@supabase/supabase-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HistoryRemote } from "../../shared/history";
import type { Segment } from "../../shared/pipeline";
import type { SavedSessionSummary } from "../../shared/intelligence";
import type { SessionContext } from "../../shared/context";
import type { AccountUsage, SubscriptionSync } from "../../shared/billing";
const url = config.supabaseUrl;
const key = config.supabasePublishableKey;
const authStorage = isTauri()
  ? {
      getItem: (key: string) =>
        invoke<string | null>("auth_storage_get", { key }),
      setItem: (key: string, value: string) =>
        invoke<void>("auth_storage_set", { key, value }),
      removeItem: (key: string) =>
        invoke<void>("auth_storage_set", { key, value: null }),
    }
  : undefined;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: !isTauri(),
          storage: authStorage,
        },
      })
    : undefined;
export const relayURL = config.relayUrl || "http://127.0.0.1:8787";
async function authRedirectURL() {
  return isTauri()
    ? nativeAuthCommand<string>("oauth_redirect_url")
    : config.authRedirectUrl || location.origin;
}
async function nativeAuthCommand<T>(command: string, args?: { url: string }): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    // Tauri serializes Rust command errors as strings, not Error instances.
    throw error instanceof Error ? error : new Error(
      typeof error === "string" ? error : "Couldn’t start browser sign-in. Please try again.",
    );
  }
}
export async function signIn(provider: "apple" | "google") {
  if (!supabase) throw new Error("Sign-in is not configured in this build.");
  const redirectTo = await authRedirectURL();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: isTauri(),
    },
  });
  if (error) throw error;
  if (isTauri() && data.url) {
    await nativeAuthCommand("begin_oauth", { url: data.url });
  }
}
function emailCredentials(email: string, password: string) {
  const normalized = email.trim();
  if (!normalized) throw new Error("Enter your email address.");
  if (!password) throw new Error("Enter your password.");
  return { email: normalized, password };
}
export async function signInWithEmailPassword(email: string, password: string) {
  if (!supabase) throw new Error("Sign-in is not configured in this build.");
  const { error } = await supabase.auth.signInWithPassword(emailCredentials(email, password));
  if (error) throw error;
}
export async function signUpWithEmailPassword(email: string, password: string) {
  if (!supabase) throw new Error("Sign-up is not configured in this build.");
  if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
  const { data, error } = await supabase.auth.signUp({
    ...emailCredentials(email, password),
    options: {
      // Confirmation links can be opened later, so native apps use the durable
      // deep link instead of Windows' short-lived OAuth loopback listener.
      emailRedirectTo: isTauri()
        ? "audeeo://auth/callback"
        : config.authRedirectUrl || location.origin,
    },
  });
  if (error) throw error;
  return !data.session;
}
export async function listenForAuth(onComplete?: (error?: string) => void) {
  if (!isTauri()) return () => {};
  const complete = async (payload: string) => {
    try {
      const callback = new URL(payload);
      if (
        callback.protocol !== "audeeo:" ||
        callback.hostname !== "auth" ||
        callback.pathname !== "/callback"
      )
        throw new Error(
          "Unexpected sign-in callback. Please try signing in again.",
        );
      if (callback.searchParams.has("error"))
        throw new Error(
          callback.searchParams.get("error") === "cancelled"
            ? "Sign-in cancelled. You can try again."
            : callback.searchParams.get("error") === "browser_unavailable"
              ? "Couldn’t open your browser. Open your default browser and try again."
              : callback.searchParams.get("error") === "already_in_progress"
                ? "Sign-in is already open. Complete or cancel it before trying again."
                : "The provider couldn’t complete sign-in. Please try again.",
        );
      const code = callback.searchParams.get("code");
      if (!code || !supabase)
        throw new Error("Sign-in could not be completed. Please try again.");
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      onComplete?.();
    } catch (error) {
      onComplete?.(
        error instanceof Error
          ? error.message
          : "Sign-in failed. Please try again.",
      );
    }
  };
  let stopped = false;
  let pending = Promise.resolve();
  const drain = () => {
    pending = pending
      .then(async () => {
        if (stopped) return;
        const callbacks = await invoke<string[]>("take_oauth_callbacks");
        for (const payload of callbacks) await complete(payload);
      })
      .catch(() =>
        onComplete?.(
          "Couldn’t receive the browser sign-in. Restart Audeeo and try again.",
        ),
      );
    return pending;
  };
  const unlisten = await listen("oauth-callback", drain);
  // Also consume callbacks delivered while the app/WebView was starting.
  await drain();
  return () => {
    stopped = true;
    unlisten();
  };
}
async function assertOwner(owner: string) {
  const session = await supabase?.auth.getSession();
  if (session?.data.session?.user.id !== owner)
    throw new Error("Sign in to the original account to sync this history.");
}
export const historyRemote: HistoryRemote = {
  async write(owner, segments, startedAt, historyGeneration) {
    if (!segments.length) return;
    await assertOwner(owner);
    const sessionId = segments[0].sessionId;
    if (segments.some(segment => segment.sessionId !== sessionId))
      throw new Error("A history batch must belong to one session.");
    const { error } = await supabase!.rpc("sync_caption_session", {
      p_id: sessionId,
      p_started_at: startedAt ?? null,
      p_segments: segments.map(toRow),
      p_history_generation: historyGeneration ?? null,
    });
    if (error) throw error;
  },
  async delete(owner, id) {
    await assertOwner(owner);
    const { error } = await supabase!.rpc("delete_history_session", {
      p_id: id,
    });
    if (error) throw error;
  },
};
export type SessionHistorySettings = {saveSessions:boolean;generation:number;retentionDays:30};
export async function getSessionHistorySettings(owner: string): Promise<SessionHistorySettings> {
  await assertOwner(owner);
  const {data,error}=await supabase!.rpc('get_session_history_settings');
  if(error)throw error;
  return data as SessionHistorySettings;
}
export async function setSessionHistorySettings(owner: string, enabled: boolean): Promise<SessionHistorySettings> {
  await assertOwner(owner);
  const {data,error}=await supabase!.rpc('set_session_history_settings',{p_enabled:enabled});
  if(error)throw error;
  return data as SessionHistorySettings;
}
function toRow(s: Segment) {
  return {
    id: s.id,
    sequence: s.sequence,
    revision: s.revision,
    start_ms: s.startMs,
    end_ms: s.endMs,
    source_language: s.sourceLanguage,
    target_language: s.targetLanguage,
    source_text: s.sourceText,
    translated_text: s.translatedText,
    state: s.state,
  };
}
export async function listHistory(owner: string, options: {all?: boolean} = {}) {
  const rows = new Map<string, HistorySession>();
  const pageSize = 100;
  for (let offset=0;;offset+=pageSize) {
    await assertOwner(owner);
    const { data, error } = await supabase!
      .from("caption_sessions")
      .select("id,started_at,source_language,target_language,updated_at,segment_count,duration_ms,preview,summary_title")
      .eq("owner_id", owner)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset+pageSize-1);
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.id,{...row,segments:[],session_summaries:[]} as HistorySession);
    if (!options.all || !data || data.length < pageSize) return [...rows.values()];
  }
}
export async function getHistorySession(owner: string, id: string): Promise<HistorySession> {
  await assertOwner(owner);
  const { data, error } = await supabase!.from("caption_sessions")
    .select("id,started_at,source_language,target_language,transcript,summary,preview,summary_title")
    .eq("id", id).eq("owner_id", owner).is("deleted_at", null).single();
  if (error) throw error;
  return { ...data, segments: data.transcript ?? [], session_summaries: data.summary ? [data.summary] : [] };
}

export async function accountRequest<T = any>(
  path: string,
  method: string,
  session: Session,
  body?: unknown,
  timeout = 15000,
) {
  const response = await fetch(`${relayURL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(config.billingEnvironment === 'sandbox' && (path.startsWith('/v1/purchases/') || path === '/v1/account/usage') ? {'X-Audeeo-Billing-Environment':'sandbox'} : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Account request failed. Retry.");
  return data as T;
}

export function getAccountUsage(session: Session) {
  return accountRequest<AccountUsage>("/v1/account/usage", "GET", session);
}

export function syncSubscriptionUsage(session: Session) {
  return accountRequest<SubscriptionSync>("/v1/purchases/restore", "POST", session);
}

export type HistorySession = {
  id: string;
  started_at: string;
  source_language: string;
  target_language: string;
  preview?: string;
  summary_title?: string | null;
  segments: Array<Record<string, any>>;
  session_summaries: SavedSessionSummary[];
};
export function generateSessionSummary(session: Session, id: string, language: string, instructions: string) {
  return accountRequest(`/v1/sessions/${encodeURIComponent(id)}/summary`, "POST", session,
    { language, instructions }, 100000) as Promise<SavedSessionSummary>;
}
export function askSessionQuestion(session: Session, id: string, language: string, question: string) {
  return accountRequest(`/v1/sessions/${encodeURIComponent(id)}/questions`, "POST", session,
    { language, question }, 100000) as Promise<{ answer: string; citations: Array<{ quote: string; startMs: number }> }>;
}
export function contextFromScreenshot(session: Session, image: string, targetLanguage: string) {
  return accountRequest("/v1/context/from-screenshot", "POST", session,
    { image, targetLanguage }, 100000) as Promise<SessionContext>;
}

let purchasePending = false;
export async function nativePurchase(action: string, session: Session) {
  if (purchasePending)
    throw new Error("Finish the current subscription request first.");
  if (!isTauri()) throw new Error("Native purchases require the Apple app.");
  purchasePending = true;
  const requestID = crypto.randomUUID();
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  try {
    return await new Promise<any>((resolve, reject) => {
      // Interactive store sheets can stay open for several minutes. Never time them
      // out and accidentally attribute a late completion to another purchase.
      if (action === "info" || action === "offer") {
        timer = setTimeout(
          () => reject(new Error("Subscription request timed out. Retry.")),
          30000,
        );
      }
      void (async () => {
        unlisten = await listen<string>("purchase-result", ({ payload }) => {
          try {
            const data = JSON.parse(payload);
            if (data.requestID !== requestID) return;
            if (data.error) reject(new Error(data.error));
            else resolve(data);
          } catch {
            reject(new Error("Invalid subscription response. Retry."));
          }
        });
        if (finished) {
          unlisten();
          return;
        }
        await invoke("purchase_action", {
          action: JSON.stringify({ action, requestID }),
          owner: session.user.id,
          key: config.revenueCatAppleKey || "",
        });
      })().catch(reject);
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    unlisten?.();
    purchasePending = false;
  }
}

export function packPurchaseStatus(session:Session,transactionId:string,productID:string,after=0,quantity=1) {
 return accountRequest(`/v1/purchases/status?transaction=${encodeURIComponent(transactionId)}&product=${encodeURIComponent(productID)}&after=${after}&quantity=${quantity}`, 'GET',session) as Promise<import('../../shared/minutePacks').PackPurchaseStatus>;
}
