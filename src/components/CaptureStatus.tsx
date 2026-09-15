import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {SessionPhase} from '../lib/presentation';
import {systemAudioLabel, type CaptureSources, type InputMode} from '../lib/platform';

export function captureSourceViewportWidth(available: number, natural: number, detailed: boolean) {
  return detailed ? Math.min(available, Math.max(1, Math.floor(natural * .9))) : available;
}
export function CaptureStatus({input, status, playing, platform, captureSourceId = 'all'}: {
  input: InputMode; status: SessionPhase; playing: boolean; platform: string; captureSourceId?: string;
}) {
  const [sources,setSources] = useState<CaptureSources | null>(null);
  const copy = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [viewportWidth,setViewportWidth] = useState<number>();
  const [distance,setDistance] = useState(0);
  const [scrolling,setScrolling] = useState(false);
  useEffect(()=>{
    setSources(null);
    if (platform !== 'macos' && platform !== 'windows' && platform !== 'android' && platform !== 'ios') return;
    let disposed=false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh=async()=>{
      try {
        const value=await invoke<CaptureSources>('capture_sources');
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
  const selected = captureSourceId === 'all' ? undefined : sources?.captureSources?.find(source=>source.id===captureSourceId)?.name;
  const apps=input !== 'microphone' && status === 'live' && captureSourceId === 'all' ? sources?.applications ?? [] : [];
  const playbackName=selected || apps.join(' · ') || systemAudioLabel(platform);
  const microphoneName=sources?.microphone || 'Microphone';
  const name=input === 'mixed' ? `${microphoneName} + ${playbackName}` : input === 'microphone' ? microphoneName : playbackName;
  useLayoutEffect(()=>{
    const measure=()=>{
      if (!copy.current || !viewport.current || !text.current) return;
      const available = copy.current.clientWidth;
      const natural = text.current.scrollWidth;
      // Detailed native device names deliberately reveal at most 90% of their
      // intrinsic width, making the shared edge fade and travel discoverable.
      const width = captureSourceViewportWidth(available,natural,!!sources);
      setViewportWidth(width);
      setDistance(Math.max(0,natural-width));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer=new ResizeObserver(measure);
    if (copy.current) observer.observe(copy.current);
    if (text.current) observer.observe(text.current);
    return ()=>observer.disconnect();
  },[name,sources]);
  useEffect(()=>{
    setScrolling(false);
    if (distance <= 0) return;
    const timer=setTimeout(()=>setScrolling(true),1200);
    return ()=>clearTimeout(timer);
  },[input,name,distance]);
  const detail=status === 'connecting' ? 'Connecting' : status === 'stopping' ? 'Finishing captions' : status === 'live' ? (input === 'mixed' ? 'Mixing microphone and desktop audio' : input === 'system' ? (platform === 'android' ? 'Capturing allowed device audio' : platform === 'ios' ? 'Capturing approved device playback' : 'Capturing desktop audio from active apps') : 'Listening') : playing ? 'Playing translation' : 'Ready';
  const description=`${detail} · ${input !== 'microphone' && apps.length ? input === 'mixed' ? `${microphoneName}, ${apps.join(', ')}` : apps.join(', ') : name}`;
  return <div className={`capture-status ${status}`} role="status" aria-label={description} title={description}>
    <div ref={copy} className="capture-status-copy" aria-hidden="true">
      <div ref={viewport} className={`capture-source-window${distance > 0 ? ' overflowing' : ''}${scrolling ? ' scrolling' : ''}`} style={{width:viewportWidth, "--source-travel":`-${distance}px`, "--source-duration":`${Math.max(9,distance/18*2+3)}s`} as CSSProperties}><span ref={text} key={`${input}:${name}`} className="capture-source-name">{name}</span></div>
    </div>
  </div>;
}
