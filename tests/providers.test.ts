import { describe, expect, it } from "vitest";
import {
  captionProviders,
  emptyProviderKeys,
  providerCredentials,
  providerModeDescription,
} from "../src/lib/providers";

describe("caption provider settings", () => {
  it("uses the Audeeo allowance by default", () => {
    const keys = emptyProviderKeys();
    expect(providerCredentials("audeeo", keys)).toBeUndefined();
    expect(providerModeDescription("audeeo", keys)).toContain("subscription");
  });

  it("keeps supported providers centralized and trims the selected key", () => {
    expect(captionProviders.map(({ id }) => id)).toEqual(["openai", "soniox"]);
    expect(providerCredentials("openai", { openai: "  sk-personal  ", soniox: "" }))
      .toEqual({ provider: "openai", apiKey: "sk-personal" });
  });

  it("does not silently spend subscription usage when a personal provider has no key", () => {
    expect(() => providerCredentials("soniox", emptyProviderKeys()))
      .toThrow("Add your Soniox API key");
  });
});
