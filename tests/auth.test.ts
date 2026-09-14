import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  callback: undefined as any,
  pending: [] as string[],
  exchange: vi.fn(),
  oauth: vi.fn(),
}));
vi.mock("../src/lib/config", () => ({
  config: {
    supabaseUrl: "https://auth.example.test",
    supabasePublishableKey: "test-only-public-key",
    relayUrl: "http://localhost:8787",
    authRedirectUrl: "",
    revenueCatAppleKey: "",
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command === "oauth_redirect_url")
      return "http://127.0.0.1:49152/auth/callback";
    return command === "take_oauth_callbacks"
      ? auth.pending.splice(0)
      : undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, callback: any) => {
    auth.callback = callback;
    return () => {};
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      exchangeCodeForSession: auth.exchange,
      signInWithOAuth: auth.oauth,
    },
  }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  auth.exchange.mockReset();
  auth.oauth.mockReset();
  auth.pending = [];
});
it.each(["google", "apple"] as const)(
  "starts %s OAuth with the prepared native PKCE callback",
  async (provider) => {
    const { signIn } = await import("../src/lib/account");
    const { invoke } = await import("@tauri-apps/api/core");
    auth.oauth.mockResolvedValue({
      data: { url: "https://auth.example.test/auth/v1/authorize" },
      error: null,
    });
    await signIn(provider);
    expect(auth.oauth).toHaveBeenCalledWith({
      provider,
      options: {
        redirectTo: "http://127.0.0.1:49152/auth/callback",
        skipBrowserRedirect: true,
      },
    });
    expect(invoke).toHaveBeenCalledWith("oauth_redirect_url");
    expect(invoke).toHaveBeenCalledWith("begin_oauth", {
      url: "https://auth.example.test/auth/v1/authorize",
    });
  },
);
it("finishes pending native sign-in on cancellation and rejects unrelated callback URLs", async () => {
  const { listenForAuth } = await import("../src/lib/account");
  const complete = vi.fn();
  await listenForAuth(complete);
  auth.pending.push("audeeo://auth/callback?error=cancelled");
  await auth.callback();
  expect(complete).toHaveBeenLastCalledWith(
    "Sign-in cancelled. You can try again.",
  );
  auth.pending.push("https://example.test/callback?code=test");
  await auth.callback();
  expect(auth.exchange).not.toHaveBeenCalled();
  expect(complete).toHaveBeenLastCalledWith(
    "Unexpected sign-in callback. Please try signing in again.",
  );
});
it("reports token exchange failures and only completes successfully after exchanging the code", async () => {
  const { listenForAuth } = await import("../src/lib/account");
  const complete = vi.fn();
  await listenForAuth(complete);
  auth.exchange.mockResolvedValueOnce({
    error: new Error("Sign-in expired. Try again."),
  });
  auth.pending.push("audeeo://auth/callback?code=test-code");
  await auth.callback();
  expect(complete).toHaveBeenLastCalledWith("Sign-in expired. Try again.");
  auth.exchange.mockResolvedValueOnce({ error: null });
  auth.pending.push("audeeo://auth/callback?code=new-test-code");
  await auth.callback();
  expect(auth.exchange).toHaveBeenLastCalledWith("new-test-code");
  expect(complete).toHaveBeenLastCalledWith();
});

it("consumes a callback queued before the WebView listener starts exactly once", async () => {
  const { listenForAuth } = await import("../src/lib/account");
  auth.pending.push("audeeo://auth/callback?code=cold-start-code");
  auth.exchange.mockResolvedValue({ error: null });
  const complete = vi.fn();
  await listenForAuth(complete);
  await auth.callback();
  expect(auth.exchange).toHaveBeenCalledExactlyOnceWith("cold-start-code");
  expect(complete).toHaveBeenCalledWith();
});

it("reports an already-open native authentication session without exchanging a code", async () => {
  const { listenForAuth } = await import("../src/lib/account");
  const complete = vi.fn();
  await listenForAuth(complete);
  auth.pending.push("audeeo://auth/callback?error=already_in_progress");
  await auth.callback();
  expect(auth.exchange).not.toHaveBeenCalled();
  expect(complete).toHaveBeenLastCalledWith("Sign-in is already open. Complete or cancel it before trying again.");
});
