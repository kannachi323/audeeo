import { invoke, isTauri } from "@tauri-apps/api/core";
import { emptySessionContext, sessionContext, type SessionContext } from "../../shared/context";

const browserKey = "audeeo.session-context";
export async function loadSessionContext(): Promise<SessionContext> {
  try {
    const raw = isTauri() ? await invoke<string | null>("context_storage_get") : import.meta.env.DEV ? localStorage.getItem(browserKey) : null;
    return raw ? sessionContext(JSON.parse(raw)) : emptySessionContext();
  } catch { return emptySessionContext(); }
}
export async function saveSessionContext(value: SessionContext) {
  const normalized = sessionContext(value), raw = JSON.stringify(normalized);
  if (isTauri()) await invoke("context_storage_set", {value:raw});
  else if (import.meta.env.DEV) localStorage.setItem(browserKey, raw);
}
