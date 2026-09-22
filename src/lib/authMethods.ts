import { config } from "./config";

/** Public provider settings; never enable a login method on the server here. */
export async function emailSignInAvailable(): Promise<boolean> {
  if (!config.supabaseUrl || !config.supabasePublishableKey) return false;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: config.supabasePublishableKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const settings = await response.json();
  return settings.external?.email === true;
}
