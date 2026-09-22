import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),raw:null as string|null}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:native.invoke}));
import { saveSessionContext, loadSessionContext, loadContextSessions, saveContextSession, removeContextSessions, pruneContextSessions, refillSessionContext, type ContextSession } from '../src/lib/contextStorage';
import { emptySessionContext } from '../shared/context';
beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-09-15T23:00:00Z"));
  native.raw=null;
  native.invoke.mockReset().mockImplementation(async(command,args)=>{
    if(command==='context_storage_get')return native.raw;
    if(command==='context_storage_set')native.raw=args.value;
  });
});
afterEach(()=>vi.useRealTimers());
const snapshot=(owner='owner-a',id='session-a'):ContextSession=>({owner,id,startedAt:'2026-09-15T22:00:00Z',label:'Physics lecture',source:'en',target:'zh',context:{...emptySessionContext(),category:'science',text:'Physics lecture',terms:['entropy'],translationTerms:[{source:'entropy',target:'熵'}]}});
it('waits for an outstanding draft write before clearing the saved context',async()=>{
  let release!:()=>void;
  const storage=native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==='context_storage_set' && JSON.parse(args.value).text) await new Promise<void>(resolve=>{release=resolve;});
    return storage(command,args);
  });
  const draft=saveSessionContext({...emptySessionContext(),text:'Previous session'});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const cleared=saveSessionContext(emptySessionContext());
  await Promise.resolve();
  expect(native.invoke.mock.calls.filter(([command])=>command==='context_storage_set')).toHaveLength(1);
  release();
  await Promise.all([draft,cleared]);
  expect(await loadSessionContext()).toEqual(emptySessionContext());
});
it('preserves reusable snapshots when clearing the active context and isolates accounts',async()=>{
  await saveSessionContext(snapshot().context);
  await saveContextSession(snapshot());
  await saveContextSession(snapshot('owner-b','session-b'));
  await saveSessionContext(emptySessionContext());
  expect(await loadSessionContext()).toEqual(emptySessionContext());
  expect(await loadContextSessions('owner-a')).toEqual([snapshot()]);
  expect(await loadContextSessions('owner-b')).toEqual([snapshot('owner-b','session-b')]);
  await removeContextSessions('owner-a','session-a');
  expect(await loadContextSessions('owner-a')).toEqual([]);
  expect(await loadContextSessions('owner-b')).toHaveLength(1);
  await removeContextSessions('owner-b');
  expect(await loadContextSessions('owner-b')).toEqual([]);
});
it('bounds the archive, skips empty contexts, and replaces existing session snapshots',async()=>{
  await saveContextSession({...snapshot(),context:emptySessionContext()});
  expect(await loadContextSessions('owner-a')).toEqual([]);
  for(let i=0;i<32;i++) await saveContextSession({...snapshot('owner-a',`session-${i}`),startedAt:new Date(Date.now()-60000+i*1000).toISOString()});
  const records=await loadContextSessions('owner-a');
  expect(records).toHaveLength(30);
  expect(records[0].id).toBe('session-31');
  await saveContextSession({...records[0],label:'Updated label'});
  expect((await loadContextSessions('owner-a'))[0].label).toBe('Updated label');
  expect(await loadContextSessions('owner-a')).toHaveLength(30);
});
it('restores all fields for the same pair and drops translation overrides for a different pair',()=>{
  expect(refillSessionContext(snapshot(),'en','zh')).toEqual(snapshot().context);
  expect(refillSessionContext(snapshot(),'zh','en')).toEqual({...snapshot().context,translationTerms:[]});
});

it('physically removes expired snapshots and invalidated generations, including after restart',async()=>{
  await saveContextSession(snapshot());
  await saveContextSession({...snapshot('owner-a','current'),historyGeneration:3});
  await saveContextSession({...snapshot('owner-b','expired'),startedAt:'2026-08-01T00:00:00Z'});
  const kept=await pruneContextSessions('owner-a',3);
  expect(kept.map(item=>item.id)).toEqual(['current']);
  expect(JSON.parse(native.raw!).savedContexts.map((item:any)=>item.id)).toEqual(['current']);
});
