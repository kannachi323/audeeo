import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Mail } from "lucide-react";
import audeeoLogo from "../../assets/audeeo-logo.png";
import { accountRequest } from "../lib/account";
import {
  customerInfo,
  subscriptionAction,
  subscriptionPlans,
  type Plan,
} from "../lib/subscriptions";
import { captionProviders, type ProviderId, type ProviderKeys, type ProviderMode } from "../lib/providers";
import { Button } from "./Button";
import { CaptionProviderLogo } from "./CaptionProviderLogo";
import { ProviderIcon } from "./ProviderIcon";
import { Select } from "./Select";

export const AUDEEO_PRO_FEATURES = [
  "Live captions",
  "Real-time translation",
  "Spoken translation audio",
  "Desktop, application, and microphone audio",
  "Floating caption overlay",
  "Synced caption history",
  "Session summaries and Q&A",
  "Custom context and terminology",
  "No provider API keys required",
] as const;

type Stage = "account" | "choice" | "subscription" | "keys" | "ready";

function OnboardingHeading({ children }: { children: string }) {
  return <header className="onboarding-heading">
    <img className="desktop-onboarding-logo" src={audeeoLogo} alt="Audeeo" />
    <h1>{children}</h1>
  </header>;
}

export function DesktopOnboarding({
  session,
  platform,
  configured,
  authPending,
  error,
  initialMode,
  keys,
  onSocialSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onSignOut,
  onResetAuth,
  onMode,
  onKey,
  onComplete,
}: {
  session: Session | null;
  platform: string;
  configured: boolean;
  authPending: boolean;
  error: string;
  initialMode: ProviderMode;
  keys: ProviderKeys;
  onSocialSignIn: (provider: "apple" | "google") => void;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string) => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onResetAuth: () => void;
  onMode: (mode: ProviderMode) => void;
  onKey: (provider: ProviderId, key: string) => void;
  onComplete: (mode: ProviderMode) => void;
}) {
  const [stage, setStage] = useState<Stage>(session ? (initialMode === "audeeo" ? "choice" : "keys") : "account");
  const [keyProvider, setKeyProvider] = useState<ProviderId>(() => initialMode !== "audeeo"
    ? initialMode
    : captionProviders.find(provider => keys[provider.id].trim())?.id ?? "openai");
  const selectedProvider = captionProviders.find(provider => provider.id === keyProvider)!;
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailAction, setEmailAction] = useState<"signin" | "signup" | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan["id"]>("yearly");
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");

  useEffect(() => {
    if (!session) {
      setStage("account");
      setConfirmationRequired(false);
      return;
    }
    setStage(initialMode === "audeeo" ? "choice" : "keys");
  }, [session?.user.id]);

  useEffect(() => {
    if (stage !== "subscription" || !session) return;
    let current = true;
    setBillingBusy(true);
    setBillingMessage("");
    void (async () => {
      try {
        // RevenueCat calls are serialized. Check entitlement before loading a paywall
        // so an existing subscriber never gets asked to purchase again.
        const info = await customerInfo(session, platform);
        if (!current) return;
        setSubscriptionActive(info.active);
        if (info.active) {
          await accountRequest("/v1/purchases/restore", "POST", session);
          if (!current) return;
          onMode("audeeo");
          setStage("ready");
          return;
        }

        const availablePlans = await subscriptionPlans(session, platform);
        if (!current) return;
        setPlans(availablePlans);
        if (!availablePlans.some(plan => plan.id === selectedPlan)) {
          setSelectedPlan(availablePlans.some(plan => plan.id === "yearly") ? "yearly" : "monthly");
        }
      } catch (reason) {
        if (current) setBillingMessage(reason instanceof Error ? reason.message : "Subscriptions are unavailable. Try again.");
      } finally {
        if (current) setBillingBusy(false);
      }
    })();
    return () => { current = false; };
  }, [stage, session?.user.id, platform]);

  const selected = useMemo(() => plans.find(plan => plan.id === selectedPlan), [plans, selectedPlan]);

  async function finishSubscription(infoAlreadyActive = subscriptionActive) {
    if (!session || billingBusy) return;
    if (!infoAlreadyActive && !selected) {
      setBillingMessage("Subscriptions are unavailable. Try again.");
      return;
    }
    setBillingBusy(true);
    setBillingMessage("");
    try {
      let active = infoAlreadyActive;
      if (!active) {
        const info = await subscriptionAction(session, selected!.id, platform);
        if (!info) return;
        active = info.active;
      }
      if (!active) {
        setBillingMessage("Audeeo Pro is not active yet. Refresh purchases before trying again.");
        return;
      }
      setSubscriptionActive(true);
      await accountRequest("/v1/purchases/restore", "POST", session);
      onMode("audeeo");
      setStage("ready");
    } catch (reason) {
      setBillingMessage(reason instanceof Error ? reason.message : "Subscription request failed. Try again.");
    } finally {
      setBillingBusy(false);
    }
  }

  async function restoreSubscription() {
    if (!session || billingBusy) return;
    setBillingBusy(true);
    setBillingMessage("");
    try {
      const info = await customerInfo(session, platform);
      setSubscriptionActive(info.active);
      if (!info.active) {
        setBillingMessage("No active Audeeo Pro subscription found.");
        return;
      }
      await accountRequest("/v1/purchases/restore", "POST", session);
      onMode("audeeo");
      setStage("ready");
    } catch (reason) {
      setBillingMessage(reason instanceof Error ? reason.message : "Could not refresh purchases. Try again.");
    } finally {
      setBillingBusy(false);
    }
  }

  function finishKeys() {
    if (!keys[keyProvider].trim()) return;
    onMode(keyProvider);
    setStage("ready");
  }

  const pageKey = stage === "account" ? `${stage}-${emailOpen ? "email" : "methods"}` : stage;

  return <main className="desktop-onboarding" aria-label="Audeeo setup">
    <section key={pageKey} className={`desktop-onboarding-card stage-${stage}`}>
      {stage === "account" && <>
        <OnboardingHeading>Welcome to Audeeo</OnboardingHeading>
        {!emailOpen ? <div className="onboarding-auth-actions">
          <Button variant="default" disabled={!configured || authPending} onClick={() => onSocialSignIn("apple")}>
            <ProviderIcon provider="apple"/><span>Continue with Apple</span>
          </Button>
          <Button variant="default" disabled={!configured || authPending} onClick={() => onSocialSignIn("google")}>
            <ProviderIcon provider="google"/><span>Continue with Google</span>
          </Button>
          <Button variant="outline" disabled={!configured || authPending} onClick={() => setEmailOpen(true)}>
            <Mail aria-hidden="true"/><span>Continue with email</span>
          </Button>
        </div> : <form className="onboarding-email" onSubmit={event => {
          event.preventDefault();
          if (!email.trim() || !password || authPending || emailAction) return;
          setEmailAction("signin");
          void onEmailSignIn(email.trim(), password)
            .catch(() => undefined)
            .finally(() => setEmailAction(null));
        }}>
          <label htmlFor="onboarding-email">Email</label>
          <input id="onboarding-email" type="email" value={email} autoComplete="email" required
            disabled={authPending || confirmationRequired} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="onboarding-password">Password</label>
          <input id="onboarding-password" type="password" value={password} autoComplete="current-password" required
            disabled={authPending || confirmationRequired} onChange={event => setPassword(event.target.value)} />
          <Button type="submit" disabled={!configured || authPending || !!emailAction || confirmationRequired || !email.trim() || !password}>
            {emailAction === "signin" ? "Signing in…" : "Sign in"}
          </Button>
          <Button type="button" variant="outline"
            disabled={!configured || authPending || !!emailAction || confirmationRequired || !email.trim() || password.length < 8}
            onClick={() => {
              setEmailAction("signup");
              void onEmailSignUp(email.trim(), password)
                .then(required => setConfirmationRequired(required))
                .catch(() => undefined)
                .finally(() => setEmailAction(null));
            }}>
            {emailAction === "signup" ? "Creating account…" : "Create account"}
          </Button>
          <Button type="button" className="onboarding-link" variant="outline" onClick={() => {
            setEmailOpen(false);
            setConfirmationRequired(false);
            setPassword("");
            onResetAuth();
          }}>
            Use another method
          </Button>
        </form>}
        {!configured && <p className="onboarding-message" role="status">Sign-in is unavailable in this build.</p>}
        {confirmationRequired && <p className="onboarding-message" role="status">Check your email to confirm your account.</p>}
        {authPending && !emailOpen && <p className="onboarding-message" role="status">Complete sign-in in your browser.</p>}
        {error && <p className="onboarding-message error" role="alert">{error}</p>}
      </>}

      {stage === "choice" && <>
        <OnboardingHeading>Choose your setup</OnboardingHeading>
        <div className="onboarding-choice-grid">
          <article className="onboarding-choice featured">
            <h2>Audeeo Pro</h2>
            <Button onClick={() => setStage("subscription")}>Choose Audeeo</Button>
          </article>
          <article className="onboarding-choice">
            <h2>Bring your own keys</h2>
            <Button variant="outline" onClick={() => setStage("keys")}>Use my keys</Button>
          </article>
        </div>
      </>}

      {stage === "subscription" && <>
        <Button className="onboarding-back" variant="outline" onClick={() => setStage("choice")}><ArrowLeft aria-hidden="true"/><span>Back</span></Button>
        <OnboardingHeading>Audeeo Pro</OnboardingHeading>
        <ul className="onboarding-features">
          {AUDEEO_PRO_FEATURES.map(feature => <li key={feature}>{feature}</li>)}
        </ul>
        {!subscriptionActive && <div className="onboarding-plan-grid" aria-label="Subscription plans">
          {plans.map(plan => <button key={plan.id} type="button" className={selectedPlan === plan.id ? "selected" : ""}
            aria-pressed={selectedPlan === plan.id} onClick={() => setSelectedPlan(plan.id)}>
            <strong>{plan.id === "yearly" ? "Yearly" : "Monthly"}</strong>
            <span>{plan.price} / {plan.id === "yearly" ? "year" : "month"}</span>
            {plan.id === "yearly" && <small>Save 17%</small>}
          </button>)}
        </div>}
        <Button className="onboarding-primary" disabled={billingBusy || (!subscriptionActive && !selected)}
          onClick={() => void finishSubscription()}>
          {billingBusy ? "Please wait…" : subscriptionActive ? "Continue" : "Subscribe"}
        </Button>
        <Button className="onboarding-link" variant="outline" disabled={billingBusy}
          onClick={() => void restoreSubscription()}>Restore purchases</Button>
        {billingMessage && <p className="onboarding-message" role="status">{billingMessage}</p>}
      </>}

      {stage === "keys" && <>
        <Button className="onboarding-back" variant="outline" onClick={() => setStage("choice")}><ArrowLeft aria-hidden="true"/><span>Back</span></Button>
        <OnboardingHeading>Connect your keys</OnboardingHeading>
        <div className="onboarding-key-fields">
          <div className="provider-select-field">
            <label>
              Provider
              <Select label="Caption provider" value={keyProvider} onChange={setKeyProvider}
                options={captionProviders.map(provider => ({
                  value: provider.id,
                  label: provider.name,
                  icon: <CaptionProviderLogo provider={provider.id}/>,
                }))}/>
            </label>
          </div>
          <label htmlFor={`onboarding-${keyProvider}-key`}>{selectedProvider.name} API key</label>
          <input id={`onboarding-${keyProvider}-key`} type="password" value={keys[keyProvider]} autoComplete="off" spellCheck={false}
            maxLength={512} placeholder={selectedProvider.keyPlaceholder} onChange={event => onKey(keyProvider, event.target.value)} />
        </div>
        <Button className="onboarding-primary" disabled={!keys[keyProvider].trim()} onClick={finishKeys}>Save &amp; continue</Button>
        <Button className="onboarding-link" variant="outline" onClick={() => setStage("subscription")}>Use Audeeo instead</Button>
      </>}

      {stage === "ready" && <>
        <OnboardingHeading>You&apos;re ready</OnboardingHeading>
        <Button className="onboarding-primary" onClick={() => onComplete(initialMode === "audeeo"
          ? "audeeo"
          : keys[initialMode].trim()
            ? initialMode
            : keys.openai.trim() ? "openai" : "soniox")}>Start using Audeeo</Button>
      </>}

      {session && <Button className="onboarding-sign-out" variant="outline" onClick={() => void onSignOut()}>
        Sign out
      </Button>}
    </section>
  </main>;
}
