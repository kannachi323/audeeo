import {MinutePacks} from "./MinutePacks";
import type {AccountUsage} from "../../shared/billing";
import {SignOutButton} from "./SignOutButton";
import {SubscriptionSummary} from "./SubscriptionSummary";
import {LegalFooter} from "./LegalLinks";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Mail } from "lucide-react";
import audeeoLogo from "../../assets/audeeo-logo.png";
import { accountRequest } from "../lib/account";
import { emailSignInAvailable } from "../lib/authMethods";
import {
  customerInfo,
  subscriptionAction,
  subscriptionPlans,
  type Plan,
} from "../lib/subscriptions";
import { Button } from "./Button";
import { ProviderIcon } from "./ProviderIcon";

type Stage = "account" | "choice" | "subscription" | "packs" | "ready";

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
  onSocialSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onSignOut,
  onResetAuth,
  onComplete,
  onUsePersonalKey,
}: {
  session: Session | null;
  platform: string;
  configured: boolean;
  authPending: boolean;
  error: string;
  onSocialSignIn: (provider: "apple" | "google") => void;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string) => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onResetAuth: () => void;
  onComplete: (mode: "audeeo") => void;
  onUsePersonalKey?:()=>void;
}) {
  const [stage, setStage] = useState<Stage>(session ? "choice" : "account");
  const [existingUsage,setExistingUsage]=useState<AccountUsage|null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
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
    if (session || !configured) return;
    let current = true;
    void emailSignInAvailable().then(enabled => {
      if (current) setEmailEnabled(enabled);
    }).catch(() => { if (current) setEmailEnabled(false); });
    return () => { current = false; };
  }, [configured, session?.user.id]);

  useEffect(() => {
    if (!session) {
      setStage("account");
      setConfirmationRequired(false);
      return;
    }
    setStage("choice");
    setExistingUsage(null);
    let canceled=false;
    void accountRequest<AccountUsage>("/v1/purchases/restore","POST",session).then(usage=>{if(!canceled)setExistingUsage(usage);}).catch(()=>{});
    return ()=>{canceled=true;};
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
          setStage("ready");
          return;
        }

        const availablePlans = await subscriptionPlans(session, platform);
        if (!current) return;
        setPlans(availablePlans);
        if (!availablePlans.length) setBillingMessage("Plans are unavailable right now. Please try again later.");
        if (!availablePlans.some(plan => plan.id === selectedPlan)) {
          setSelectedPlan(availablePlans.some(plan => plan.id === "yearly") ? "yearly" : "monthly");
        }
      } catch {
        if (current) setBillingMessage("Plans are unavailable right now. Please try again later.");
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
      setStage("ready");
    } catch {
      setBillingMessage("Could not complete your subscription. Please try again.");
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
      setStage("ready");
    } catch {
      setBillingMessage("Could not restore purchases. Please try again.");
    } finally {
      setBillingBusy(false);
    }
  }


  const pageKey = stage === "account" ? `${stage}-${emailOpen ? "email" : "methods"}` : stage;

  return <main className="desktop-onboarding" aria-label="Audeeo setup">
    <div className="onboarding-content">
    {onUsePersonalKey && <Button variant="outline" onClick={onUsePersonalKey}>Use my own API key instead</Button>}
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
          {emailEnabled && <Button variant="outline" disabled={!configured || authPending} onClick={() => setEmailOpen(true)}>
            <Mail aria-hidden="true"/><span>Continue with email</span>
          </Button>}
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
        <Button onClick={()=>onComplete("audeeo")}>{existingUsage?.active || existingUsage?.unlimited || (existingUsage?.purchasedSeconds??0)>0 ? 'Continue with your balance' : 'Continue free'}</Button>
        <div className="onboarding-choice-grid">
          <article className="onboarding-choice featured">
            <h2>Subscriptions</h2>
            <Button onClick={() => setStage("subscription")}>Subscribe</Button>
          </article>
          <article className="onboarding-choice">
            <h2>Minute packs</h2>
            <Button variant="outline" onClick={() => setStage("packs")}>Buy minute packs</Button>
          </article>
        </div>
      </>}

      {stage === "subscription" && <>
        <Button className="onboarding-back" variant="outline" onClick={() => setStage("choice")}><ArrowLeft aria-hidden="true"/><span>Back</span></Button>
        <OnboardingHeading>Audeeo Pro</OnboardingHeading>
        {!subscriptionActive && plans.length > 0 && <div className="onboarding-plan-grid" aria-label="Subscription plans">
          {plans.map(plan => <button key={plan.id} type="button" className={selectedPlan === plan.id ? "selected" : ""}
            aria-pressed={selectedPlan === plan.id} onClick={() => setSelectedPlan(plan.id)}>
            <strong>{plan.id === "yearly" ? "Yearly" : "Monthly"}</strong>
            <span>{plan.price} / {plan.id === "yearly" ? "year" : "month"}</span>

          </button>)}
        </div>}
        <SubscriptionSummary apple={platform === "macos"} plan={selected}/>
        <Button className="onboarding-primary" disabled={billingBusy || (!subscriptionActive && !selected)}
          onClick={() => void finishSubscription()}>
          {billingBusy ? "Please wait…" : subscriptionActive ? "Continue" : "Subscribe"}
        </Button>
        <Button className="onboarding-link" variant="outline" disabled={billingBusy}
          onClick={() => void restoreSubscription()}>Restore purchases</Button>
        {billingMessage && <p className="onboarding-message" role="status">{billingMessage}</p>}
      </>}

      {stage === "packs" && session && <>
        <Button variant="outline" onClick={()=>setStage("choice")}><ArrowLeft/>Back</Button>
        <OnboardingHeading>Buy minute packs</OnboardingHeading>
        <MinutePacks session={session} platform={platform} onSynced={setExistingUsage}/>
        <Button onClick={()=>onComplete("audeeo")}>Start using Audeeo</Button>
      </>}
      {stage === "ready" && <><OnboardingHeading>You&apos;re ready</OnboardingHeading><Button className="onboarding-primary" variant="default" onClick={()=>onComplete("audeeo")}>Continue</Button></>}

      {session && stage !== "ready" && <SignOutButton user={session.user} onSignOut={()=>void onSignOut()}/>}
    </section>
    </div>
    <LegalFooter/>
  </main>;
}
