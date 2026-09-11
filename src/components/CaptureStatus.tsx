import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {SessionPhase} from '../lib/presentation';

type Sources = {microphone: string; applications: string[]};
export function CaptureStatus({input, status, playing, platform}: {
  input: 'microphone'|'system'; status: SessionPhase; playing: boolean; platform: string;
}) {
  const [sources,setSources] = useState<Sources | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [distance,setDistance] = useState(0);
  const [scrolling,setScrolling] = useState(false);
  useEffect(()=>{
    setSources(null);
    if (platform !== 'macos') return;
    let disposed=false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh=async()=>{
      try {
        const value=await invoke<Sources>('capture_sources');
        if (!disposed && value && Array.isArray(value.applications)) setSources(value);
      } catch { if (!disposed) setSources(null); }
      finally {
        // Schedule after completion so slow device queries cannot accumulate.
        if (!disposed && status === 'live') timer=setTimeout(()=>void refresh(),2000);
      }
    };
    void refresh();
    return ()=>{disposed=true;clearTimeout(timer);};
  },[platform,input,status]);
  const apps=input === 'system' && status === 'live' ? sources?.applications ?? [] : [];
  const name=input === 'microphone' ? sources?.microphone || 'Microphone' : apps.join(' · ') || 'All device audio';
  useLayoutEffect(()=>{
    const measure=()=>{
      if (viewport.current && text.current) setDistance(Math.max(0,text.current.scrollWidth-viewport.current.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer=new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (text.current) observer.observe(text.current);
    return ()=>observer.disconnect();
  },[name]);
  useEffect(()=>{
    setScrolling(false);
    if (distance <= 0) return;
    const timer=setTimeout(()=>setScrolling(true),1200);
    return ()=>clearTimeout(timer);
  },[input,name,distance]);
  const detail=status === 'connecting' ? 'Connecting' : status === 'stopping' ? 'Finishing captions' : status === 'live' ? (input === 'system' ? 'Capturing device audio' : 'Listening') : playing ? 'Playing translation' : 'Ready';
  const description=`${detail} · ${input === 'system' && apps.length ? apps.join(', ') : name}`;
  return <div className={`capture-status ${status}`} role="status" aria-label={description} title={description}>
    <div className="capture-status-copy" aria-hidden="true">
      <div ref={viewport} className={`capture-source-window${distance > 0 ? ' overflowing' : ''}${scrolling ? ' scrolling' : ''}`} style={{"--source-travel":`-${distance}px`, "--source-duration":`${Math.max(9,distance/18*2+3)}s`} as CSSProperties}><span ref={text} key={`${input}:${name}`} className="capture-source-name">{name}</span></div>
    </div>
  </div>;
}
