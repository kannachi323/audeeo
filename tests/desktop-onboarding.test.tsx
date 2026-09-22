// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  plans: vi.fn(),
  action: vi.fn(),
  reconcile: vi.fn(),
  emailAvailable: vi.fn(),
}));

vi.mock("../src/lib/subscriptions", () => ({
  minutePackOffers: vi.fn().mockResolvedValue([]),
  purchaseMinutePack: vi.fn(),
  customerInfo: mocks.info,
  subscriptionPlans: mocks.plans,
  subscriptionAction: mocks.action,
}));
vi.mock("../src/lib/account", () => ({ accountRequest: mocks.reconcile, syncSubscriptionUsage:mocks.reconcile }));
vi.mock("../src/lib/authMethods", () => ({ emailSignInAvailable: mocks.emailAvailable }));

import { DesktopOnboarding } from "../src/components/DesktopOnboarding";
import { AUDEEO_PRO_FEATURES } from "../src/components/SubscriptionSummary";


const session = {
  user: { id: "test-owner", email: "person@example.test" },
  access_token: "test-token",
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.info.mockResolvedValue({ active: false });
  mocks.plans.mockResolvedValue([
    { id: "yearly", price: "$80", productID: "yearly" },
    { id: "monthly", price: "$8", productID: "monthly" },
  ]);
  mocks.reconcile.mockResolvedValue({ active: true });
  mocks.emailAvailable.mockResolvedValue(true);
});
afterEach(cleanup);
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);

function Harness({
  complete = vi.fn(),
  signOut = vi.fn(),
  signedIn = true,
  emailSignIn = vi.fn(),
  emailSignUp = vi.fn(),
}: {
  complete?: (mode: "audeeo") => void;
  signOut?: () => Promise<void> | void;
  signedIn?: boolean;
  emailSignIn?: (email: string, password: string) => Promise<void> | void;
  emailSignUp?: (email: string, password: string) => Promise<boolean> | boolean;
}) {
  return <DesktopOnboarding
    session={signedIn ? session : null}
    platform="windows"
    configured
    authPending={false}
    error=""
    onSocialSignIn={vi.fn()}
    onEmailSignIn={async (email, password) => { await emailSignIn(email, password); }}
    onEmailSignUp={async (email, password) => await emailSignUp(email, password)}
    onSignOut={async () => { await signOut(); }}
    onResetAuth={vi.fn()}
    onComplete={complete}
  />;
}

it("uses email and password for sign-in and account creation", async () => {
  const user = userEvent.setup();
  const emailSignIn = vi.fn();
  const emailSignUp = vi.fn().mockResolvedValue(true);
  render(<Harness signedIn={false} emailSignIn={emailSignIn} emailSignUp={emailSignUp} />);
  await user.click(await screen.findByRole("button", { name: "Continue with email" }));
  await user.type(screen.getByLabelText("Email"), "person@example.test");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(emailSignIn).toHaveBeenCalledWith("person@example.test", "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(emailSignUp).toHaveBeenCalledWith("person@example.test", "password123");
  expect(await screen.findByText("Check your email to confirm your account.")).toBeTruthy();
});

it("hides email sign-in when the hosted provider is disabled", async () => {
  mocks.emailAvailable.mockResolvedValue(false);
  render(<Harness signedIn={false} />);
  await screen.findByRole("button", { name: "Continue with Apple" });
  expect(screen.queryByRole("button", { name: "Continue with email" })).toBeNull();
});

it("lets a signed-in user sign out before completing setup", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn();
  render(<Harness signOut={signOut} />);
  const signOutButton = screen.getByRole("button", { name: /^Sign out/ });
  expect(signOutButton.closest('main')?.lastElementChild).toBe(screen.getByRole('navigation',{name:'Legal and support'}).parentElement);
  expect(screen.queryByText("Recommended")).toBeNull();
  await user.click(signOutButton);
  expect(signOut).toHaveBeenCalledOnce();
});

it("shows concise feature highlights and both priced plans", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Subscribe" }));
  for (const feature of AUDEEO_PRO_FEATURES) expect(await screen.findByText(feature)).toBeTruthy();
  expect(await screen.findByRole("button", { name: /Yearly.*\$80 \/ year/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Monthly.*\$8 \/ month/ })).toBeTruthy();
  const allowance = screen.getByText('600 usage minutes / month').parentElement!;
  expect(allowance.textContent).toContain('$80 / year');
  await user.click(screen.getByRole('button', {name: /Monthly.*\$8 \/ month/}));
  expect(allowance.textContent).toContain('$8 / month');
  expect(allowance.textContent).not.toContain('$80 / year');
});

it.each(['rejected', 'empty'])("handles %s offerings without exposing SDK diagnostics or enabling purchase", async failure => {
  if (failure === 'rejected') mocks.plans.mockRejectedValue(new Error('SDK configuration error: https://rev.cat/sdk-troubleshooting'));
  else mocks.plans.mockResolvedValue([]);
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', {name: 'Subscribe'}));
  expect(await screen.findByText('Plans are unavailable right now. Please try again later.')).toBeTruthy();
  expect(screen.queryByText(/SDK configuration error/)).toBeNull();
  expect((screen.getByRole('button', {name: 'Subscribe'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', {name: 'Restore purchases'})).toBeTruthy();
  expect(screen.getByText('Price unavailable')).toBeTruthy();
});

it("replaces BYOK with minute packs", async()=>{
 render(<Harness/>);
 expect(screen.queryByRole('button',{name:'Use my keys'})).toBeNull();
 await userEvent.click(screen.getByRole('button',{name:'Buy minute packs'}));
 expect(screen.getByRole('heading',{name:'Buy minute packs',level:1})).toBeTruthy();
});

it("remounts onboarding pages for transitions and shows an arrow on Back", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const choicePage = screen.getByRole("heading", { name: "Choose your setup" }).closest("section");
  await user.click(screen.getByRole("button", { name: "Buy minute packs" }));
  const back = screen.getByRole("button", { name: "Back" });
  expect(back.querySelector("svg")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Buy minute packs",level:1 }).closest("section")).not.toBe(choicePage);
  await user.click(back);
  expect(screen.getByRole("heading", { name: "Choose your setup" })).toBeTruthy();
});

it("reconciles an active RevenueCat purchase before finishing onboarding", async () => {
  const user = userEvent.setup();
  const complete = vi.fn();
  const signOut = vi.fn();
  mocks.action.mockResolvedValue({ active: true });
  render(<Harness complete={complete} signOut={signOut} />);
  await user.click(screen.getByRole("button", { name: "Subscribe" }));
  await user.click(await screen.findByRole("button", { name: "Subscribe" }));
  expect(mocks.action).toHaveBeenCalledWith(session, "yearly", "windows");
  expect(mocks.reconcile).toHaveBeenCalledWith("/v1/purchases/restore", "POST", session);
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  expect(complete).toHaveBeenCalledWith("audeeo");
  expect(signOut).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /^Sign out/ })).toBeNull();
});

it("recognizes an existing paid subscription before loading purchase plans", async () => {
  const user = userEvent.setup();
  mocks.info.mockResolvedValue({ active: true });
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Subscribe" }));

  expect(await screen.findByRole("heading", { name: "You're ready" })).toBeTruthy();
  expect(mocks.info).toHaveBeenCalledWith(session, "windows");
  expect(mocks.reconcile).toHaveBeenCalledWith("/v1/purchases/restore", "POST", session);
  expect(mocks.plans).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
});

it('lets a free account start using its server-granted minutes without a purchase',async()=>{
 mocks.reconcile.mockResolvedValue({active:false,unlimited:false,remainingSeconds:1800,includedSeconds:1800,purchasedSeconds:0});
 const complete=vi.fn();
 render(<Harness complete={complete}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Continue free'}));
 expect(complete).toHaveBeenCalledWith('audeeo');
 expect(mocks.action).not.toHaveBeenCalled();
});
it('allows entry to the free app after the allowance is exhausted',async()=>{
 mocks.reconcile.mockResolvedValue({active:false,unlimited:false,remainingSeconds:0,includedSeconds:1800,purchasedSeconds:0});
 render(<Harness/>);
 await userEvent.click(screen.getByRole('button',{name:'Buy minute packs'}));
 await screen.findByText('Prices are unavailable. Retry to load them.');
 expect(screen.getByRole('button',{name:'Start using Audeeo'})).toBeTruthy();
 await userEvent.click(screen.getByRole('button',{name:'Back'}));
 expect(screen.getByRole('button',{name:'Continue free'})).toBeTruthy();
});

it('allows free entry when the store cannot be reached',async()=>{
 mocks.reconcile.mockRejectedValue(new Error('offline'));
 const complete=vi.fn();render(<Harness complete={complete}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Continue free'}));
 expect(complete).toHaveBeenCalledWith('audeeo');
 expect(mocks.action).not.toHaveBeenCalled();
});
