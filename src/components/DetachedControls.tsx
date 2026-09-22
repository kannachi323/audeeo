import {useEffect, useLayoutEffect, useRef, useState, type ComponentProps} from 'react';
import {emitTo, listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {AudioControls} from './AudioControls';
import {NativeSelectProvider} from './Select';
type Controls = ComponentProps<typeof AudioControls>;
export type ControlSnapshot = {[K in keyof Controls as Controls[K] extends Function ? never : K]: Controls[K]};
export function DetachedControls() {
  const [snapshot,setSnapshot]=useState<ControlSnapshot & {_presentation:number;canCaptureContext?:boolean;canRefillContext?:boolean}>();
  const fields=useRef<HTMLDivElement>(null);
  const current=useRef(snapshot);current.current=snapshot;
  useEffect(()=>{
    const own=getCurrentWindow(); let disposed=false; const cleanups:(()=>void)[]=[];
    const add=(fn:()=>void)=>disposed?fn():cleanups.push(fn);
    const ready=()=>emitTo('main','controls-ready',{label:own.label});
    void Promise.all([
      listen<ControlSnapshot & {_presentation:number;canCaptureContext?:boolean;canRefillContext?:boolean}>('controls-state',({payload})=>setSnapshot(payload)),
      listen('controls-ping',()=>{if(!disposed)void ready();}),
    ]).then(listeners=>{
      listeners.forEach(add); if(!disposed) void ready();
    });
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!document.querySelector('[data-caption-select]')) {
        event.preventDefault(); void emitTo('main','controls-dismiss',{label:own.label,presentation:current.current?._presentation});
      }
    };
    document.addEventListener('keydown',escape);
    return ()=>{disposed=true;cleanups.forEach(fn=>fn());document.removeEventListener('keydown',escape);};
  },[]);
  useLayoutEffect(()=>{
    if(!snapshot||!fields.current)return;
    const measure=()=>{
      const contentHeight=Math.ceil(fields.current!.getBoundingClientRect().height+28);
      void emitTo('main','controls-rendered',{presentation:snapshot._presentation,contentHeight});
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(fields.current);
    return()=>observer.disconnect();
  },[snapshot]);
  if(!snapshot) return <main className="detached-controls" role="status">Loading controls…</main>;
  const change=(key:string,value:unknown)=>void emitTo('main','controls-change',{label:getCurrentWindow().label,presentation:snapshot._presentation,key,value});
  const setters=Object.fromEntries(Object.keys(snapshot).map(key=>['set'+key[0].toUpperCase()+key.slice(1),(value:unknown)=>change(key,typeof value==='function'?value(snapshot[key as keyof ControlSnapshot]):value)]));
  return <main className="detached-controls" role="dialog" aria-label="Audio controls"><NativeSelectProvider><div ref={fields}><AudioControls {...snapshot} {...setters as unknown as Controls} onRefillContextFromSession={snapshot.canRefillContext ? id=>void emitTo("main","controls-context-refill",{label:getCurrentWindow().label,presentation:snapshot._presentation,id}) : undefined} onFillContextFromScreen={snapshot.canCaptureContext ? ()=>void emitTo("main","controls-context-capture",{label:getCurrentWindow().label,presentation:snapshot._presentation}) : undefined}/></div></NativeSelectProvider></main>;
}
