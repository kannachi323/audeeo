// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../src/lib/config", () => ({
  config: {
    supabaseUrl: "",
    supabasePublishableKey: "",
    relayUrl: "http://localhost:8787",
    authRedirectUrl: "",
    revenueCatAppleKey: "",
    revenueCatWebKey: "",
  },
}));
import App from "../src/App";
import { SignIn } from "../src/components/SignIn";
import { Configuration } from "../src/components/Configuration";
vi.mock("../src/lib/config", () => ({
  config: {
    supabaseUrl: "",
    supabasePublishableKey: "",
    relayUrl: "",
    authRedirectUrl: "",
    revenueCatAppleKey: "",
  },
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("shows the caption panel before sign-in and routes Start to Account", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByLabelText("Live captions")).toBeTruthy();
  expect(screen.queryByText("Understand every word.")).toBeNull();
  await user.click(screen.getByRole("button", {name:"Start captions"}));
  expect(screen.getByRole("heading", {name:"Account"})).toBeTruthy();
  expect((screen.getByRole("button", {name:"Continue with Apple"}) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard('{Escape}');
  expect(screen.getByLabelText("Live captions")).toBeTruthy();
});
it("routes configured social sign-in correctly and disables duplicate attempts while pending", async () => {
  const user = userEvent.setup();
  const signIn = vi.fn();
  const view = render(
    <SignIn configured pending={false} error="" onSignIn={signIn} />,
  );
  await user.click(screen.getByRole("button", { name: "Continue with Apple" }));
  expect(signIn).toHaveBeenLastCalledWith("apple");
  await user.click(
    screen.getByRole("button", { name: "Continue with Google" }),
  );
  expect(signIn).toHaveBeenLastCalledWith("google");
  view.rerender(<SignIn configured pending error="" onSignIn={signIn} />);
  expect(
    (
      screen.getByRole("button", {
        name: "Continue with Google",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getByRole("status")).toBeTruthy();
});
it("keeps unsupported capture and live input changes unavailable without pretending speech works", () => {
  render(
    <Configuration
      mode="subtitles" onMode={vi.fn()} target="en" onTarget={vi.fn()}
      input="microphone"
      source="zh"
      active
      systemAudio={false}
      save
      onInput={vi.fn()}
      onSource={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Device playback",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("combobox", {
        name: "Speaker language",
      }) as HTMLSelectElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("checkbox", {
        name: /Don’t save this session/,
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByText(
      "Not available in this build. Translation is shown as captions.",
    ),
  ).toBeTruthy();
});
