/** Tauri 2.11 dereferences missing listener entries before removing the Rust listener. */
export function guardEventCleanup(host: {
  __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener(event: string, id: number): void };
}) {
  const events = host.__TAURI_EVENT_PLUGIN_INTERNALS__;
  if (!events) return;
  const unregister = events.unregisterListener.bind(events);
  events.unregisterListener = (event, id) => {
    try {
      unregister(event, id);
    } catch (error) {
      // Let the SDK continue to plugin:event|unlisten for an absent JS entry.
      if (!(error instanceof TypeError) || !error.message.includes('handlerId')) throw error;
    }
  };
}
