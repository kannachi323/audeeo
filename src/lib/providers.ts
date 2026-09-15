export const captionProviders = [
  {
    id: "openai",
    name: "OpenAI",
    keyPlaceholder: "sk-…",
    description: "Realtime captions and spoken translation.",
  },
  {
    id: "soniox",
    name: "Soniox",
    keyPlaceholder: "Enter your Soniox API key",
    description: "Realtime transcription and translation.",
  },
] as const;

export type ProviderId = (typeof captionProviders)[number]["id"];
export type ProviderMode = "audeeo" | ProviderId;
export type ProviderKeys = Record<ProviderId, string>;
export type ProviderCredentials = { provider: ProviderId; apiKey: string };

export function emptyProviderKeys(): ProviderKeys {
  return Object.fromEntries(captionProviders.map(({ id }) => [id, ""])) as ProviderKeys;
}

export function providerCredentials(
  mode: ProviderMode,
  keys: ProviderKeys,
): ProviderCredentials | undefined {
  if (mode === "audeeo") return undefined;
  const apiKey = keys[mode].trim();
  if (!apiKey) {
    const provider = captionProviders.find(({ id }) => id === mode)!;
    throw new Error(`Add your ${provider.name} API key in Settings → Providers, or choose Audeeo subscription.`);
  }
  return { provider: mode, apiKey };
}

export function providerModeDescription(mode: ProviderMode, keys: ProviderKeys) {
  if (mode === "audeeo") return "Use your Audeeo subscription";
  const provider = captionProviders.find(({ id }) => id === mode)!;
  return `${provider.name} · ${keys[mode].trim() ? "personal key" : "key required"}`;
}
