import { invoke, isTauri } from "@tauri-apps/api/core";
import { emptySessionContext, hasSessionContext, sessionContext, type SessionContext } from "../../shared/context";

export type ContextSession = {
  owner: string; id: string; startedAt: string; label: string;
  source: string; target: string; context: SessionContext; historyGeneration?: number;
};
type ContextStore = SessionContext & {savedContexts?: ContextSession[]};
const browserKey = "audeeo.session-context";
const maxSessions = 30;
let pendingSave: Promise<unknown> = Promise.resolve();

function contextSession(value: ContextSession): ContextSession {
  if (!value || ['owner','id','source','target'].some(key=>typeof value[key as keyof ContextSession] !== 'string' || !(value[key as keyof ContextSession] as string).length || (value[key as keyof ContextSession] as string).length > 128)
    || typeof value.label !== 'string' || value.label.length > 160 || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)))
    throw new Error('Saved session context is invalid.');
  return {owner:value.owner,id:value.id,startedAt:value.startedAt,label:value.label,source:value.source,target:value.target,context:sessionContext(value.context),...(Number.isSafeInteger(value.historyGeneration) ? {historyGeneration:value.historyGeneration} : {})};
}
async function readStore(): Promise<ContextStore> {
  const raw = isTauri() ? await invoke<string | null>("context_storage_get") : import.meta.env.DEV ? localStorage.getItem(browserKey) : null;
  if (!raw) return emptySessionContext();
  const parsed = JSON.parse(raw);
  const savedContexts = (Array.isArray(parsed?.savedContexts) ? parsed.savedContexts : []).slice(0,maxSessions).flatMap((item: ContextSession)=>{
    try { const snapshot=contextSession(item); return hasSessionContext(snapshot.context) && Date.parse(snapshot.startedAt)>Date.now()-30*86400000 ? [snapshot] : []; } catch { return []; }
  });
  return {...sessionContext(parsed),...(savedContexts.length ? {savedContexts} : {})};
}
function updateStore(update: (store: ContextStore)=>ContextStore): Promise<ContextStore> {
  // Serialize draft, archive and clear writes so none can restore stale data.
  const write = pendingSave.catch(()=>undefined).then(async()=>{
    const next = update(await readStore()), raw = JSON.stringify(next);
    if (isTauri()) await invoke("context_storage_set", {value:raw});
    else if (import.meta.env.DEV) localStorage.setItem(browserKey, raw);
    return next;
  });
  pendingSave = write;
  return write;
}
export async function loadSessionContext(): Promise<SessionContext> {
  try { await pendingSave.catch(()=>undefined); return sessionContext(await readStore()); }
  catch { return emptySessionContext(); }
}
export async function saveSessionContext(value: SessionContext) {
  const normalized = sessionContext(value);
  await updateStore(store=>({...normalized,...(store.savedContexts?.length ? {savedContexts:store.savedContexts} : {})}));
}
export async function loadContextSessions(owner: string) {
  await pendingSave.catch(()=>undefined);
  return (await readStore()).savedContexts?.filter(item=>item.owner===owner) ?? [];
}
export async function saveContextSession(value: ContextSession) {
  const snapshot=contextSession(value);
  if (!hasSessionContext(snapshot.context)) return loadContextSessions(snapshot.owner);
  const store=await updateStore(current=>({...current,savedContexts:[snapshot,...(current.savedContexts ?? []).filter(item=>item.owner!==snapshot.owner || item.id!==snapshot.id)].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,maxSessions)}));
  return store.savedContexts!.filter(item=>item.owner===snapshot.owner);
}
export async function removeContextSessions(owner: string, id?: string) {
  const store=await updateStore(current=>({...current,savedContexts:(current.savedContexts ?? []).filter(item=>item.owner!==owner || (id!==undefined && item.id!==id))}));
  return store.savedContexts!.filter(item=>item.owner===owner);
}
export async function pruneContextSessions(owner: string, generation: number) {
  const store=await updateStore(current=>({...current,savedContexts:(current.savedContexts ?? []).filter(item=>item.owner!==owner || (item.historyGeneration ?? 1)===generation)}));
  return store.savedContexts!.filter(item=>item.owner===owner);
}
export function refillSessionContext(snapshot: ContextSession, source: string, target: string): SessionContext {
  const context=sessionContext(snapshot.context);
  return {...context,translationTerms:snapshot.source===source && snapshot.target===target ? context.translationTerms : []};
}
