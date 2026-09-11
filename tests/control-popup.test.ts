import {it, expect, vi} from 'vitest';
const mock=vi.hoisted(()=>({handlers:new Map<string,Function[]>(),create:vi.fn(),hide:vi.fn(),position:vi.fn(),size:vi.fn(),emit:vi.fn(),invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:mock.invoke}));
vi.mock('@tauri-apps/api/event',()=>({emitTo:mock.emit,listen:async(name:string,fn:Function)=>{mock.handlers.set(name,[...(mock.handlers.get(name)||[]),fn]);return()=>mock.handlers.set(name,(mock.handlers.get(name)||[]).filter(f=>f!==fn));}}));
vi.mock('@tauri-apps/api/window',()=>({BackgroundThrottlingPolicy:{Disabled:'disabled'},getCurrentWindow:()=>({innerPosition:async()=>({x:100,y:100}),scaleFactor:async()=>1,onMoved:async()=>()=>{},onResized:async()=>()=>{}}),currentMonitor:async()=>({workArea:{position:{x:0,y:0},size:{width:1000,height:800}}})}));
vi.mock('@tauri-apps/api/webviewWindow',()=>({WebviewWindow:class {constructor(label:string,options:any){mock.create(label,options);queueMicrotask(()=>mock.handlers.get('controls-ready')?.forEach(fn=>fn({payload:{label}})));}hide=mock.hide;destroy=vi.fn();setPosition=mock.position;setSize=mock.size;setAlwaysOnTop=vi.fn();once=async()=>()=>{};}}));
import {openControlPopup,warmControlPopup} from '../src/lib/controlPopup';
it('keeps the host hidden and presents only rendered controls through AppKit without moving or resizing either window',async()=>{
  await warmControlPopup();
  expect(mock.create).toHaveBeenCalledOnce();
  const options=mock.create.mock.calls[0][1];
  expect(options.visible).toBe(false);
  expect(options.parent).toBeUndefined();
  for(const group of ['input','languages','silence']) {
    const handle=await openControlPopup({left:20,top:150,width:36,height:36} as DOMRect,()=>({group,active:false}) as any,()=>{});
    const state=mock.emit.mock.calls.at(-1)![2];
    const previous=mock.invoke.mock.calls.length;
    mock.handlers.get('controls-rendered')?.forEach(fn=>fn({payload:{presentation:state._presentation-1}}));
    expect(mock.invoke).toHaveBeenCalledTimes(previous);
    mock.handlers.get('controls-rendered')?.forEach(fn=>fn({payload:{presentation:state._presentation,contentHeight:420}}));
    expect(mock.invoke).toHaveBeenLastCalledWith('show_controls_popover',expect.objectContaining({x:20,y:150,width:36,height:36,contentHeight:420}));
    handle.dispose();
    expect(mock.invoke).toHaveBeenLastCalledWith('close_controls_popover');
  }
  expect(mock.create).toHaveBeenCalledOnce();
  expect(mock.position).not.toHaveBeenCalled();
  expect(mock.size).not.toHaveBeenCalled();
  expect(mock.hide).not.toHaveBeenCalled();
});
