import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isTauri } from "@tauri-apps/api/core";
import {Sparkles, RotateCcw, Settings2, ExternalLink} from "lucide-react";
import { Button } from "./Button";
import { syncSubscriptionUsage } from "../lib/account";
import { customerInfo, subscriptionPlans, subscriptionAction, subscriptionManagementURL,
  type Plan, type SubscriptionInfo } from "../lib/subscriptions";
import type { AccountUsage } from "../../shared/billing";

function minutes(seconds: number) {
  const value = seconds / 60;
  return value > 0 && value < 10 && !Number.isInteger(value)
    ? value.toFixed(1)
    : Math.round(value).toLocaleString();
}

export function Subscriptions({ session, platform, disabled, onBusy }: {
  session: Session; platform: string; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false), pending = useRef(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  const supported = !isTauri() || platform === "ios" || platform === "macos" || platform === "windows";
  async function run(action?: "restore" | "paywall" | "manage" | "yearly" | "monthly") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); onBusy(true); setMessage("");
    try {
      const account = currentSession.current;
      const result = action ? await subscriptionAction(account, action, platform) : await customerInfo(account, platform);
      if (!mounted.current) return;
      if (result) {
        setInfo(result);
        setUsage(null);
        try {
            const synced = await syncSubscriptionUsage(currentSession.current);
            if (mounted.current) {
              setUsage(synced);
              setMessage(synced.active ? "Audeeo Pro is active." : "No active Audeeo Pro subscription found.");
            }
          } catch {
            if (mounted.current) setMessage("Subscription status retrieved, but account allowance could not be synced. Refresh purchases to retry; do not purchase again.");
          }
      }
      // Customer status remains available even if the offering is misconfigured.
      if (!action || action === "restore") {
        const available = await subscriptionPlans(account, platform);
        if (mounted.current) setPlans(available);
      }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Subscription request failed. Please retry.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
      onBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (supported) void run();
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending.current && supported) void run();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { mounted.current = false; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const managementURL = subscriptionManagementURL(info);
  if (!supported) return <p>Subscriptions are available in Audeeo on the web and Apple devices.</p>;
  return <section className="subscription-settings" aria-label="Audeeo Pro subscription" aria-busy={busy}>
    <div className="subscription-heading"><Sparkles aria-hidden="true"/><h2>Audeeo Pro</h2><span className="subscription-badge">{busy ? "Loading…" : info ? ((usage?.active ?? info.active) ? "Active" : "Free") : "Unavailable"}</span></div>
    {info?.expiresAt && <small>{info.willRenew ? "Renews" : "Access until"} {new Date(info.expiresAt).toLocaleDateString()}</small>}
    {usage && <small className="subscription-usage">
      {usage.unlimited
        ? `${minutes(usage.usedSeconds)} minutes used · unlimited account`
        : `${minutes(usage.usedSeconds)} of ${minutes(usage.includedSeconds ?? 0)} minutes used · ${minutes(usage.remainingSeconds ?? 0)} remaining`}
    </small>}
    {!info?.active && <>
      {plans.map(plan => <Button key={plan.id} disabled={disabled || busy || !info} onClick={() => void run(plan.id)}>
        {plan.id === "yearly" ? "Yearly" : "Monthly"} · {plan.price} / {plan.id === "yearly" ? "year" : "month"}
      </Button>)}
      {(!isTauri() || platform === "ios") && <Button disabled={disabled || busy || !info} onClick={() => void run("paywall")}>View subscription options</Button>}

    </>}
    <Button disabled={disabled || busy} onClick={() => void run("restore")} className="subscription-action"><RotateCcw aria-hidden="true"/>{isTauri() ? "Restore purchases" : "Refresh purchases"}</Button>
    {platform === "ios" && <Button disabled={disabled || busy} onClick={() => void run("manage")} className="subscription-action"><Settings2 aria-hidden="true"/>Manage subscription</Button>}
    {platform !== "ios" && managementURL && <a href={managementURL} target="_blank" rel="noopener noreferrer" className="subscription-action"><ExternalLink aria-hidden="true"/>Manage subscription</a>}
    {platform !== "ios" && !managementURL && info?.active && <small>Manage your subscription using the link in your billing email or your store settings.</small>}
    {message && <p className="subscription-message" role="status">{/RevenueCat|apple-native-build/.test(message) ? "Purchases are unavailable in this version." : message}</p>}
  </section>;
}
