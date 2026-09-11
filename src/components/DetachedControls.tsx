import {useEffect, useLayoutEffect, useRef, useState, type ComponentProps} from 'react';
import {emitTo, listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {AudioControls} from './AudioControls';
type Controls = ComponentProps<typeof AudioControls>;
export type ControlSnapshot = {[K in keyof Controls as Controls[K] extends Function ? never : K]: Controls[K]};
export function DetachedControls() {
  const [snapshot,setSnapshot]=useState<ControlSnapshot & {_presentation:number}>();
  const fields=useRef<HTMLDivElement>(null);
  const [menuBottom,setMenuBottom]=useState(0);
  const current=useRef(snapshot);current.current=snapshot;
  useEffect(()=>{
    const own=getCurrentWindow(); let disposed=false; const cleanups:(()=>void)[]=[];
    const add=(fn:()=>void)=>disposed?fn():cleanups.push(fn);
    void listen<ControlSnapshot & {_presentation:number}>('controls-state',({payload})=>setSnapshot(payload)).then(fn=>{
      add(fn); if(!disposed) void emitTo('main','controls-ready',{label:own.label});
    });
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!document.querySelector('[data-caption-select]')) {
        event.preventDefault(); void emitTo('main','controls-dismiss',{label:own.label,presentation:current.current?._presentation});
      }
    };
    document.addEventListener('keydown',escape);
    return ()=>{disposed=true;cleanups.forEach(fn=>fn());document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{
    const space=(event:Event)=>setMenuBottom((event as CustomEvent<number>).detail);
    document.addEventListener('caption-select-space',space);
    return()=>document.removeEventListener('caption-select-space',space);
  },[]);
  useLayoutEffect(()=>{
    if(!snapshot||!fields.current)return;
    const measure=()=>{
      const contentHeight=Math.ceil(Math.max(fields.current!.getBoundingClientRect().height+28,menuBottom));
      void emitTo('main','controls-rendered',{presentation:snapshot._presentation,contentHeight});
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(fields.current);
    return()=>observer.disconnect();
  },[snapshot?._presentation,menuBottom]);
  if(!snapshot) return null;
  const change=(key:string,value:unknown)=>void emitTo('main','controls-change',{label:getCurrentWindow().label,key,value});
  const setters=Object.fromEntries(Object.keys(snapshot).map(key=>['set'+key[0].toUpperCase()+key.slice(1),(value:unknown)=>change(key,typeof value==='function'?value(snapshot[key as keyof ControlSnapshot]):value)]));
  return <main className="detached-controls" role="dialog" aria-label="Audio controls"><div ref={fields}><AudioControls {...snapshot} {...setters as unknown as Controls}/></div></main>;
}
