import {AccountLoading, RefreshIndicator} from "./AccountLoading";
import {MinutePacks, type MinutePacksHandle} from "./MinutePacks";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {DailyBudgetDialog} from "./DailyBudgetDialog";
import {normalizeDailyBudget, type DailyBudget} from "../lib/dailyBudget";
import type {ReactNode} from "react";
import { Button } from "./Button";
import { syncSubscriptionUsage } from "../lib/account";
import { nativeBilling, customerInfo, subscriptionPlans, subscriptionAction, subscriptionManagementURL,
  type Plan, type SubscriptionInfo } from "../lib/subscriptions";
import type { AccountUsage } from "../../shared/billing";

function minutes(seconds: number) {
  const value = seconds / 60;
  return value > 0 && value < 10 && !Number.isInteger(value)
    ? value.toFixed(1)
    : Math.round(value).toLocaleString();
}

export function UsageOverview({usage,busy,dailyBudget,onEdit}:{usage:AccountUsage|null;busy:boolean;dailyBudget:DailyBudget;onEdit?:()=>void}) {
  const purchased=usage?.purchasedSeconds ?? 0;
  const remaining=usage?.totalRemainingSeconds ?? (usage?.remainingSeconds ?? 0)+purchased;
  const dailyPercent=dailyBudget.minutes ? Math.min(100,Math.floor(dailyBudget.usedSeconds/(dailyBudget.minutes*60)*100)) : 0;
  return <>
    {usage ? <div className="usage-plan">
      <div className="usage-hero">
        <div className="usage-metric" aria-label={usage.unlimited ? `${minutes(usage.usedSeconds)} min used` : `${minutes(remaining)} min remaining`}>
          <strong>{minutes(usage.unlimited ? usage.usedSeconds : remaining)}</strong>
          <span>{usage.unlimited ? 'minutes used' : 'minutes remaining'}</span>
        </div>
        {busy && <RefreshIndicator/>}
      </div>
      {usage.unlimited && <span className="secondary">Unlimited</span>}
      {!usage.unlimited && <div className="usage-breakdown">
        <div className="usage-wallet"><span>{usage.active ? 'Plan' : 'Free'} minutes</span><span>{minutes(usage.remainingSeconds ?? 0)}</span></div>
        <div className="usage-wallet"><span>Purchased minutes</span><span>{minutes(purchased)}</span></div>
      </div>}
    </div> : busy ? <AccountLoading label="Loading usage…" kind="usage"/> : <div className="usage-unavailable"><h3>Usage unavailable</h3><p>Refresh purchases to try again.</p></div>}
    {dailyBudget.minutes ? <div className="daily-usage">
      <div className="usage-line"><h3>Daily reminder</h3><Button aria-label="Adjust daily reminder" aria-haspopup="dialog" onClick={onEdit} disabled={!onEdit}>Adjust</Button></div>
      <div className="usage-line secondary"><span>Today · {minutes(dailyBudget.usedSeconds)}{dailyBudget.minutes ? ` / ${dailyBudget.minutes}` : ''} min</span><span>{`${dailyPercent}%`}</span></div>
      {dailyBudget.minutes && <progress aria-label="Daily reminder usage" max={100} value={dailyPercent}/>}
    </div> : onEdit && <Button className="reminder-setup" aria-haspopup="dialog" onClick={onEdit}>Set daily reminder</Button>}
  </>;
}

export function SubscriptionOverview({info,usage,busy,actions,children}: {
  info:SubscriptionInfo|null;usage:AccountUsage|null;busy:boolean;actions?:ReactNode;children?:ReactNode;
}) {
  const active=usage?.sandbox?.subscriptionActive ?? usage?.active ?? info?.active;
  const promotional=info?.productID?.startsWith('rc_promo_');
  const trial=info?.periodType?.toLowerCase()==='trial';
  const introductory=info?.periodType?.toLowerCase()==='intro';
  const billingPeriod=info?.billingPeriod ?? (['audeeo_pro_yearly','audeeo_pro_yearly_web'].includes(info?.productID ?? '') ? 'year' : ['AUDEEO_MONTHLY_1','audeeo_pro_monthly_web'].includes(info?.productID ?? '') ? 'month' : undefined);
  if (busy) return <AccountLoading label="Loading subscription…"/>;
  return <>
    <div className="subscription-heading"><h3>{active ? 'Audeeo Pro' : 'Audeeo'}</h3></div>
    <div className="subscription-price">
      <strong>{promotional ? 'Complimentary access' : trial ? 'Free trial' : info?.paidPrice ? `${info.paidPrice}${billingPeriod && !introductory ? ` / ${billingPeriod}` : ''}` : (info || usage) && !active ? 'Free plan' : busy ? 'Loading plan…' : 'Price unavailable'}</strong>
      {info?.paidPrice && !promotional && !trial && (introductory || !billingPeriod) && <span className="secondary">{introductory ? 'Introductory payment' : billingPeriod==='year' ? 'Billed yearly' : billingPeriod==='month' ? 'Billed monthly' : 'Last payment'}</span>}
    </div>
    {usage?.sandbox && billingPeriod ? <dl className="subscription-date"><dt>Billing cycle</dt><dd>{billingPeriod==='year'?'Yearly':'Monthly'}</dd></dl> : info?.expiresAt && <dl className="subscription-date"><dt>{info.willRenew ? 'Renews' : 'Access until'}</dt><dd>{new Date(info.expiresAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</dd></dl>}
    {children}{actions}
  </>;
}

export function Subscriptions({ session, platform, disabled, onBusy, dailyBudget=normalizeDailyBudget(null), onDailyBudgetChange }: {
  session: Session; platform: string; disabled: boolean; onBusy: (busy: boolean) => void; dailyBudget?:DailyBudget; onDailyBudgetChange?:(minutes:number|null)=>void;
}) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [editingBudget,setEditingBudget]=useState(false);
  const packs=useRef<MinutePacksHandle>(null);
  const [refreshing,setRefreshing]=useState(false);
  async function refreshBalance(){if(refreshing)return;setRefreshing(true);try{await packs.current?.refresh();}finally{setRefreshing(false);}}
  const mounted = useRef(false), pending = useRef(false), refreshedAt=useRef(0);
  const currentSession = useRef(session);
  currentSession.current = session;
  const supported = !isTauri() || platform === "macos" || platform === "windows";
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

        try {
            const synced = await syncSubscriptionUsage(currentSession.current);
            if (mounted.current) {
              setUsage(synced);
              if (action === "restore" && !(synced.sandbox?.subscriptionActive ?? synced.active)) setMessage("No active subscription found.");
            }
          } catch {
            if (mounted.current) { setUsage(null); setMessage("Subscription status retrieved, but account allowance could not be synced. Refresh purchases to retry; do not purchase again."); }
          }
      }
      // Customer status remains available even if the offering is misconfigured.
      if (result?.active) {
        if (mounted.current) setPlans([]);
        if (result.productID && !result.productID.startsWith('rc_promo_')) {
          // A catalog match supplies cadence only. Never substitute a current offer for the customer's paid price.
          try {
            const matching=(await subscriptionPlans(account,platform)).find(plan=>plan.productID===result.productID);
            if(mounted.current && matching) setInfo({...result,billingPeriod:matching.id==='yearly' ? 'year' : 'month'});
          } catch { /* Account status and paid price remain usable without a catalog. */ }
        }
      } else if (!action || action === "restore") {
        const available = await subscriptionPlans(account, platform);
        if (mounted.current) setPlans(available);
      }
    } catch (error) {
      try {const synced=await syncSubscriptionUsage(currentSession.current);if(mounted.current)setUsage(synced);} catch { /* Keep the last known balance. */ }
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Subscription request failed. Please retry.");
    } finally {
      pending.current = false;refreshedAt.current=Date.now();
      if (mounted.current) setBusy(false);
      onBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (supported) void run();
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending.current && supported && Date.now()-refreshedAt.current>30000) void run();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { mounted.current = false; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const managementURL = subscriptionManagementURL(info) || (nativeBilling(platform) ? "https://apps.apple.com/account/subscriptions" : null);
  if (!supported) return <p>Subscriptions are available in Audeeo on the web and Apple devices.</p>;
  const actions=<div className="subscription-actions">
    {managementURL && <a href={managementURL} target="_blank" rel="noopener noreferrer" className="subscription-action" aria-disabled={disabled || busy} onClick={event => {
      if(disabled || busy) {event.preventDefault();return;}
      if (platform !== "macos" || !isTauri()) return;
      event.preventDefault();
      void invoke("open_external_url", { url: managementURL }).catch(() => setMessage("Could not open subscription settings. Open the App Store to manage your subscription."));
    }}>Manage subscription</a>}
    <Button disabled={disabled || busy} onClick={() => void run("restore")} className="subscription-action">{busy && <span className="button-spinner" aria-hidden="true"/>}{isTauri() ? "Restore purchases" : "Refresh purchases"}</Button>
  </div>;
  return <>
    <div className="account-plan-grid">
      <section className="account-group" aria-label="Subscription" aria-busy={busy}>
        <h2>Subscription</h2>
        <div className="settings-panel subscription-settings">
          <SubscriptionOverview info={info} usage={usage} busy={busy} actions={actions}>
            {info && !(usage?.sandbox?.subscriptionActive ?? info.active) && <>
              {plans.map(plan=><Button key={plan.id} disabled={disabled || busy} onClick={()=>void run(plan.id)}>{plan.id === 'yearly' ? 'Yearly' : 'Monthly'} · {plan.price} / {plan.id === 'yearly' ? 'year' : 'month'}</Button>)}
              {!isTauri() && <Button disabled={disabled || busy} onClick={()=>void run('paywall')}>View subscription options</Button>}
            </>}
          </SubscriptionOverview>
          {!managementURL && info?.active && !info.productID?.startsWith("rc_promo_") && <details className="subscription-help"><summary>Billing help</summary><p>Manage your subscription from your billing email or store settings.</p></details>}
        </div>
      </section>
      <section className="account-group" aria-label="Usage" aria-busy={busy||refreshing}><div className="account-group-heading"><h2>Usage</h2><Button disabled={disabled||busy||refreshing} onClick={()=>void refreshBalance()}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button></div><div className="settings-panel usage-settings"><UsageOverview usage={usage} busy={busy||refreshing} dailyBudget={dailyBudget} onEdit={onDailyBudgetChange ? ()=>setEditingBudget(true) : undefined}/></div></section>
    </div>
    <MinutePacks ref={packs} session={session} platform={platform} disabled={disabled || busy || refreshing} onSynced={setUsage}/>
    {message && <p className="subscription-message" role="status">{/does not include RevenueCat|apple-native-build/.test(message) ? "Purchases are unavailable in this version." : /RevenueCat|StoreKit|App Store/.test(message) ? "The store couldn’t load subscription details. Refresh purchases to retry." : message}</p>}
    {editingBudget && onDailyBudgetChange && <DailyBudgetDialog minutes={dailyBudget.minutes} onApply={onDailyBudgetChange} onClose={()=>setEditingBudget(false)}/>}
  </>;
}
