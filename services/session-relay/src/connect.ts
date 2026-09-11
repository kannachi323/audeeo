/** Limit the handshake without aborting the upgraded, long-lived socket. */
export async function connectUpstream(endpoint: string, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}`, Upgrade: 'websocket' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
