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
}));

vi.mock("../src/lib/subscriptions", () => ({
  customerInfo: mocks.info,
  subscriptionPlans: mocks.plans,
  subscriptionAction: mocks.action,
}));
vi.mock("../src/lib/account", () => ({ accountRequest: mocks.reconcile }));

import { AUDEEO_PRO_FEATURES, DesktopOnboarding } from "../src/components/DesktopOnboarding";
import { emptyProviderKeys, type ProviderKeys, type ProviderMode } from "../src/lib/providers";

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
});
afterEach(cleanup);

function Harness({
  complete = vi.fn(),
  signOut = vi.fn(),
  signedIn = true,
  emailSignIn = vi.fn(),
  emailSignUp = vi.fn(),
}: {
  complete?: (mode: ProviderMode) => void;
  signOut?: () => Promise<void> | void;
  signedIn?: boolean;
  emailSignIn?: (email: string, password: string) => Promise<void> | void;
  emailSignUp?: (email: string, password: string) => Promise<boolean> | boolean;
}) {
  const [mode, setMode] = useState<ProviderMode>("audeeo");
  const [keys, setKeys] = useState<ProviderKeys>(emptyProviderKeys);
  return <DesktopOnboarding
    session={signedIn ? session : null}
    platform="windows"
    configured
    authPending={false}
    error=""
    initialMode={mode}
    keys={keys}
    onSocialSignIn={vi.fn()}
    onEmailSignIn={async (email, password) => { await emailSignIn(email, password); }}
    onEmailSignUp={async (email, password) => await emailSignUp(email, password)}
    onSignOut={async () => { await signOut(); }}
    onResetAuth={vi.fn()}
    onMode={setMode}
    onKey={(provider, value) => setKeys(current => ({...current, [provider]: value}))}
    onComplete={complete}
  />;
}

it("uses email and password for sign-in and account creation", async () => {
  const user = userEvent.setup();
  const emailSignIn = vi.fn();
  const emailSignUp = vi.fn().mockResolvedValue(true);
  render(<Harness signedIn={false} emailSignIn={emailSignIn} emailSignUp={emailSignUp} />);
  await user.click(screen.getByRole("button", { name: "Continue with email" }));
  await user.type(screen.getByLabelText("Email"), "person@example.test");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(emailSignIn).toHaveBeenCalledWith("person@example.test", "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(emailSignUp).toHaveBeenCalledWith("person@example.test", "password123");
  expect(await screen.findByText("Check your email to confirm your account.")).toBeTruthy();
});

it("lets a signed-in user leave onboarding from any setup path", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn();
  render(<Harness signOut={signOut} />);
  const signOutButton = screen.getByRole("button", { name: "Sign out" });
  expect(signOutButton.parentElement?.lastElementChild).toBe(signOutButton);
  expect(screen.queryByText("Recommended")).toBeNull();
  await user.click(signOutButton);
  expect(signOut).toHaveBeenCalledOnce();
});

it("keeps every desktop feature visible on the RevenueCat plan page", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Choose Audeeo" }));
  for (const feature of AUDEEO_PRO_FEATURES) expect(await screen.findByText(feature)).toBeTruthy();
  expect(await screen.findByRole("button", { name: /Yearly.*\$80 \/ year/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Monthly.*\$8 \/ month/ })).toBeTruthy();
});

it("completes BYOK with one key and leaves the last page panel-free", async () => {
  const user = userEvent.setup();
  const complete = vi.fn();
  render(<Harness complete={complete} />);
  await user.click(screen.getByRole("button", { name: "Use my keys" }));
  const save = screen.getByRole("button", { name: "Save & continue" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText("OpenAI API key"), "sk-personal");
  await user.click(save);
  expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy();
  expect(screen.queryByText("Account connected")).toBeNull();
  expect(screen.queryByText("Translation ready")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Start using Audeeo" }));
  expect(complete).toHaveBeenCalledWith("openai");
});

it("remounts onboarding pages for transitions and shows an arrow on Back", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const choicePage = screen.getByRole("heading", { name: "Choose your setup" }).closest("section");
  await user.click(screen.getByRole("button", { name: "Use my keys" }));
  const back = screen.getByRole("button", { name: "Back" });
  expect(back.querySelector("svg")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Connect your keys" }).closest("section")).not.toBe(choicePage);
  await user.click(back);
  expect(screen.getByRole("heading", { name: "Choose your setup" })).toBeTruthy();
});

it("reconciles an active RevenueCat purchase before finishing onboarding", async () => {
  const user = userEvent.setup();
  const complete = vi.fn();
  mocks.action.mockResolvedValue({ active: true });
  render(<Harness complete={complete} />);
  await user.click(screen.getByRole("button", { name: "Choose Audeeo" }));
  await user.click(await screen.findByRole("button", { name: "Subscribe" }));
  expect(mocks.action).toHaveBeenCalledWith(session, "yearly", "windows");
  expect(mocks.reconcile).toHaveBeenCalledWith("/v1/purchases/restore", "POST", session);
  await user.click(await screen.findByRole("button", { name: "Start using Audeeo" }));
  expect(complete).toHaveBeenCalledWith("audeeo");
});

it("recognizes an existing paid subscription before loading purchase plans", async () => {
  const user = userEvent.setup();
  mocks.info.mockResolvedValue({ active: true });
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Choose Audeeo" }));

  expect(await screen.findByRole("heading", { name: "You're ready" })).toBeTruthy();
  expect(mocks.info).toHaveBeenCalledWith(session, "windows");
  expect(mocks.reconcile).toHaveBeenCalledWith("/v1/purchases/restore", "POST", session);
  expect(mocks.plans).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
});
