import {it, expect, vi} from 'vitest';
const mock=vi.hoisted(()=>({handlers:new Map<string,Function[]>(),create:vi.fn(),hide:vi.fn(),position:vi.fn(),size:vi.fn(),emit:vi.fn(),invoke:vi.fn(),focus:undefined as Function|undefined}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:mock.invoke}));
vi.mock('@tauri-apps/api/event',()=>({emitTo:mock.emit,listen:async(name:string,fn:Function)=>{mock.handlers.set(name,[...(mock.handlers.get(name)||[]),fn]);return()=>mock.handlers.set(name,(mock.handlers.get(name)||[]).filter(f=>f!==fn));}}));
vi.mock('@tauri-apps/api/window',()=>({BackgroundThrottlingPolicy:{Disabled:'disabled'},getCurrentWindow:()=>({innerPosition:async()=>({x:100,y:100}),scaleFactor:async()=>1,onMoved:async()=>()=>{},onResized:async()=>()=>{}}),currentMonitor:async()=>({workArea:{position:{x:0,y:0},size:{width:1000,height:800}}})}));
vi.mock('@tauri-apps/api/webviewWindow',()=>({WebviewWindow:class {constructor(label:string,options:any){mock.create(label,options);queueMicrotask(()=>mock.handlers.get('controls-ready')?.forEach(fn=>fn({payload:{label}})));}hide=mock.hide;destroy=vi.fn();setPosition=mock.position;setSize=mock.size;setAlwaysOnTop=vi.fn();once=async()=>()=>{};onFocusChanged=async(fn:Function)=>{mock.focus=fn;return()=>{};};}}));
import {openControlPopup,supportsDetachedControls,warmControlPopup} from '../src/lib/controlPopup';
it('only enables detached controls on supported desktop platforms',()=>{
  expect(supportsDetachedControls('windows')).toBe(true);
  expect(supportsDetachedControls('macos')).toBe(true);
  expect(supportsDetachedControls('android')).toBe(false);
  expect(supportsDetachedControls('ios')).toBe(false);
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
