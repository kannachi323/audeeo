import {it, expect, vi} from 'vitest';
const mock=vi.hoisted(()=>({handlers:new Map<string,Function[]>(),create:vi.fn(),hide:vi.fn(),position:vi.fn(),size:vi.fn(),emit:vi.fn(async()=>{}),invoke:vi.fn(async()=>{}),existing:null as any,focus:undefined as Function|undefined}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:mock.invoke}));
vi.mock('@tauri-apps/api/event',()=>({emitTo:mock.emit,listen:async(name:string,fn:Function)=>{mock.handlers.set(name,[...(mock.handlers.get(name)||[]),fn]);return()=>mock.handlers.set(name,(mock.handlers.get(name)||[]).filter(f=>f!==fn));}}));
vi.mock('@tauri-apps/api/window',()=>({BackgroundThrottlingPolicy:{Disabled:'disabled'},getCurrentWindow:()=>({innerPosition:async()=>({x:100,y:100}),scaleFactor:async()=>1,onMoved:async()=>()=>{},onResized:async()=>()=>{}}),currentMonitor:async()=>({workArea:{position:{x:0,y:0},size:{width:1000,height:800}}})}));
vi.mock('@tauri-apps/api/webviewWindow',()=>({WebviewWindow:class {static getByLabel=async()=>mock.existing;constructor(label:string,options:any){mock.create(label,options);queueMicrotask(()=>mock.handlers.get('controls-ready')?.forEach(fn=>fn({payload:{label}})));}hide=mock.hide;destroy=vi.fn();setPosition=mock.position;setSize=mock.size;setAlwaysOnTop=vi.fn();once=async()=>()=>{};onFocusChanged=async(fn:Function)=>{mock.focus=fn;return()=>{};};}}));
import {openControlPopup,supportsDetachedControls,warmControlPopup} from '../src/lib/controlPopup';
it('only enables detached controls on supported desktop platforms',()=>{
  expect(supportsDetachedControls('windows')).toBe(true);
  expect(supportsDetachedControls('macos')).toBe(true);
  expect(supportsDetachedControls('browser')).toBe(false);
});
it('keeps one hidden, main-owned controls host and reuses it for every presentation',async()=>{
  await warmControlPopup('windows');
  expect(mock.create).toHaveBeenCalledOnce();
  const options=mock.create.mock.calls[0][1];
  expect(options.visible).toBe(false);
  expect(options.parent).toBe('main');
  for(const group of ['input','languages','silence']) {
    const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group,active:false,platform:'windows'}) as any,()=>{});
    const state=mock.emit.mock.calls.at(-1)![2];
    const previous=mock.invoke.mock.calls.length;
    mock.handlers.get('controls-rendered')?.forEach(fn=>fn({payload:{presentation:state._presentation-1}}));
    expect(mock.invoke).toHaveBeenCalledTimes(previous);
    mock.handlers.get('controls-rendered')?.forEach(fn=>fn({payload:{presentation:state._presentation,contentHeight:420}}));
    expect(mock.invoke).toHaveBeenLastCalledWith('show_controls_popover',expect.objectContaining({x:20,y:150,width:36,height:36,contentHeight:420}));
    const shown=mock.invoke.mock.calls.length;
    mock.handlers.get('controls-rendered')?.forEach(fn=>fn({payload:{presentation:state._presentation,contentHeight:420}}));
    expect(mock.invoke).toHaveBeenCalledTimes(shown);
    handle.dispose();
    await Promise.resolve();
    expect(mock.invoke).toHaveBeenLastCalledWith('close_controls_popover');
  }
  expect(mock.create).toHaveBeenCalledOnce();
  expect(mock.position).not.toHaveBeenCalled();
  expect(mock.size).not.toHaveBeenCalled();
  expect(mock.hide).not.toHaveBeenCalled();
});

it('dismisses the detached controls after they lose focus',async()=>{
  const dismiss=vi.fn();
  const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group:'input',active:false,platform:'windows'}) as any,dismiss);
  mock.focus?.({payload:true});
  mock.focus?.({payload:false});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(dismiss).toHaveBeenCalledOnce();
  handle.dispose();
  await Promise.resolve();
});

it('forwards context capture and edits only from the current presentation',async()=>{
  const capture=vi.fn(),update=vi.fn();
  let active=false,pending=false;
  const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group:'context',platform:'windows',active,screenCapturePending:pending,onFillContextFromScreen:capture,setTranslationContext:update}) as any,()=>{});
  const state=mock.emit.mock.calls.at(-1)![2];
  expect(state.canCaptureContext).toBe(true);
  const send=(event:string,payload:object)=>mock.handlers.get(event)?.forEach(fn=>fn({payload:{label:'controls-popup',presentation:state._presentation,...payload}}));
  send('controls-context-capture',{presentation:state._presentation-1});
  expect(capture).not.toHaveBeenCalled();
  send('controls-context-capture',{});
  expect(capture).toHaveBeenCalledOnce();
  pending=true;send('controls-context-capture',{});
  active=true;pending=false;send('controls-context-capture',{});
  expect(capture).toHaveBeenCalledOnce();
  active=false;
  const value={category:'general',text:'Edited context',terms:[],translationTerms:[]};
  send('controls-change',{key:'translationContext',value});
  expect(update).toHaveBeenCalledWith(value);
  send('controls-change',{key:'translationContext',value:{text:'invalid'}});
  expect(update).toHaveBeenCalledOnce();
  handle.dispose();await Promise.resolve();
});


it('replays current state when the controls document reloads while open',async()=>{
  const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group:'context',platform:'windows',translationContext:{category:'education',text:'Current context',terms:[],translationTerms:[]}}) as any,()=>{});
  mock.emit.mockClear();
  mock.handlers.get('controls-ready')?.forEach(fn=>fn({payload:{label:'controls-popup'}}));
  expect(mock.emit).toHaveBeenCalledWith('controls-popup','controls-state',expect.objectContaining({group:'context',translationContext:expect.objectContaining({text:'Current context'})}));
  handle.dispose();await Promise.resolve();
});

it('only refills listed sessions from the current idle presentation',async()=>{
  const refill=vi.fn(); let active=false,pending=false;
  const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group:'context',platform:'windows',active,screenCapturePending:pending,refillContextSessions:[{id:'session-a',label:'Lecture'},{id:'blank',label:'Old lecture (blank)',disabled:true}],onRefillContextFromSession:refill}) as any,()=>{});
  const state=mock.emit.mock.calls.at(-1)![2];
  expect(state.canRefillContext).toBe(true);
  const send=(extra:object={})=>mock.handlers.get('controls-context-refill')?.forEach(fn=>fn({payload:{label:'controls-popup',presentation:state._presentation,id:'session-a',...extra}}));
  send({presentation:state._presentation-1});send({id:'unknown'});send({id:'blank'});
  expect(refill).not.toHaveBeenCalled();
  send(); expect(refill).toHaveBeenCalledWith('session-a');
  active=true;send();active=false;pending=true;send();
  expect(refill).toHaveBeenCalledOnce();
  handle.dispose();await Promise.resolve();
});

it('retries a missed render acknowledgement and reports failure instead of remaining silently open',async()=>{
  vi.useFakeTimers();
  const failed=vi.fn();
  const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group:'input',platform:'windows'}) as any,()=>{},undefined,failed);
  mock.emit.mockClear();
  await vi.advanceTimersByTimeAsync(600);
  expect(mock.emit.mock.calls.filter(call=>call[1]==='controls-state')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(2400);
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({message:'Controls did not render'}));
  expect(mock.invoke).toHaveBeenLastCalledWith('close_controls_popover');
  const sent=mock.emit.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(mock.emit).toHaveBeenCalledTimes(sent);
  handle.dispose();vi.useRealTimers();
});
it('reports a native presentation error to the toolbar fallback',async()=>{
  const failed=vi.fn();
  const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group:'input',platform:'windows'}) as any,()=>{},undefined,failed);
  const state=mock.emit.mock.calls.at(-1)![2];
  mock.invoke.mockRejectedValueOnce(new Error('Host unavailable'));
  mock.handlers.get('controls-rendered')?.forEach(fn=>fn({payload:{presentation:state._presentation,contentHeight:150}}));
  await Promise.resolve();
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({message:'Host unavailable'}));
  handle.dispose();await Promise.resolve();
});

it('reattaches an existing controls host after the main document reloads',async()=>{
  vi.resetModules();
  mock.existing={destroy:vi.fn()};
  const before=mock.create.mock.calls.length;
  mock.emit.mockImplementation(async(_label,event)=>{
    if(event==='controls-ping') mock.handlers.get('controls-ready')?.forEach(fn=>fn({payload:{label:'controls-popup'}}));
  });
  const reloaded=await import('../src/lib/controlPopup');
  expect(await reloaded.warmControlPopup('macos')).toBe(mock.existing);
  expect(mock.create).toHaveBeenCalledTimes(before);
  expect(mock.existing.destroy).not.toHaveBeenCalled();
  mock.existing=null;mock.emit.mockReset();
});

it('allows another attempt after controls-host lookup fails',async()=>{
  vi.resetModules();
  const reloaded=await import('../src/lib/controlPopup');
  mock.existing=Promise.reject(new Error('Window lookup failed'));
  await expect(reloaded.warmControlPopup('macos')).rejects.toThrow('Window lookup failed');
  mock.existing=null;
  await expect(reloaded.warmControlPopup('macos')).resolves.toBeTruthy();
});
