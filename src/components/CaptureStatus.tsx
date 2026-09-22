import {useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {SessionPhase} from '../lib/presentation';
import {systemAudioLabel, type CaptureSources, type InputMode} from '../lib/platform';
import {languageName} from '../../shared/languages';
import {contextCategoryOptions, type SessionContext} from '../../shared/context';
import type {SilenceSettings} from '../../shared/silence';
import type {ControlGroup} from './AudioControls';

type SetupField = {group: ControlGroup; label: string; value: string; detail?: string};

export function CaptureStatus({input, status, playing, platform, captureSourceId = 'all',
  captionMode, source, target, translationContext, silence, microphoneMuted = false,
  desktopMuted = false, translatedMuted = false, microphoneGain = 1, desktopGain = 1, translatedVolume = 1, inputGain = false, translatedPlayback = false, onOpen, paused = false,
}: {
  input: InputMode; status: SessionPhase; playing: boolean; platform: string; captureSourceId?: string;
  captionMode: 'subtitles' | 'translate'; source: string; target: string;
  translationContext: SessionContext; silence: SilenceSettings;
  microphoneMuted?: boolean; desktopMuted?: boolean; translatedMuted?: boolean;
  microphoneGain?: number; desktopGain?: number; translatedVolume?: number;
  inputGain?: boolean; translatedPlayback?: boolean; onOpen: (group: ControlGroup) => void;
  paused?: boolean;
}) {
  const [sources,setSources] = useState<CaptureSources | null>(null);
  const [currentId, setCurrentId] = useState('Source');
  const [outgoing, setOutgoing] = useState<SetupField | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(()=>{
    setSources(null);
    if (platform !== 'macos' && platform !== 'windows') return;
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
  },[platform,input,status,captureSourceId]);
  const selected = captureSourceId === 'all' ? undefined : sources?.captureSources?.find(source=>source.id===captureSourceId)?.name;
  const desktop = platform === 'macos' || platform === 'windows';
  const playback = captureSourceId !== 'all' ? selected || 'Selected app' : desktop ? 'Desktop' : 'Device';
  const sourceLabel = input === 'microphone' ? 'Mic' : playback;
  const microphoneName = sources?.microphone || 'Microphone';
  const playbackDetails = captureSourceId !== 'all' ? selected || 'Selected application' : systemAudioLabel(platform);
  const sourceDetails = input === 'microphone' ? microphoneName : playbackDetails;
  const activeApps = input !== 'microphone' && captureSourceId === 'all' && status === 'live' ? sources?.applications ?? [] : [];
  const sourceDescription = `${sourceDetails}${activeApps.length ? ` · Playing: ${activeApps.join(', ')}` : ''}`;
  const languageLabel = captionMode === 'translate' ? 'Translate' : 'Captions';
  const languages = captionMode === 'translate' ? `${languageName(source)} → ${languageName(target)}` : languageName(source);
  const context = translationContext.category === 'custom'
    ? translationContext.customCategory?.trim() || 'Custom'
    : translationContext.category === 'general' ? 'General'
    : contextCategoryOptions.find(option=>option.value===translationContext.category)?.label || 'Custom';
  const volume = (value: number, muted: boolean, enabled = true) =>
    `${Math.round(value * 100)}%${!enabled ? ' (off)' : muted ? ' (muted)' : ''}`;
  const phase = status === 'connecting' ? 'Connecting' : status === 'stopping' ? 'Finishing captions' : status === 'live' ? 'Listening' : playing ? 'Playing translation' : 'Ready';
  const fields: SetupField[] = [
    {group:'input',label:'Source',value:sourceLabel,detail:sourceDescription},
    {group:'languages',label:languageLabel,value:languages},
    {group:'context',label:'Context',value:context},
    ...(translationContext.text.trim() ? [{group:'context' as const,label:'Notes',value:translationContext.text.trim().replace(/\s+/g,' ')}] : []),
    ...(translationContext.terms.length ? [{group:'context' as const,label:'Terms',value:translationContext.terms.join(', ')}] : []),
    ...(translationContext.translationTerms.length ? [{group:'context' as const,label:'Translations',value:translationContext.translationTerms.map(({source,target})=>`${source} → ${target}`).join(', ')}] : []),
    ...(inputGain ? [
      input === 'microphone'
        ? {group:'audio' as const,label:'Mic volume',value:volume(microphoneGain,microphoneMuted)}
        : {group:'audio' as const,label:'Desktop volume',value:volume(desktopGain,desktopMuted)},
    ] : []),
    {group:'audio',label:'Speech volume',value:translatedPlayback ? volume(translatedVolume,translatedMuted,captionMode === 'translate') : 'Unavailable'},
    {group:'silence',label:'Auto-stop',value:`${silence.timeoutSeconds}s of silence`},
    {group:'silence',label:'Silence level',value:`${silence.thresholdDbfs} dBFS`},
  ];
  const field = fields.find(field=>field.label === currentId) || fields[0];
  const fieldIds = fields.map(field=>field.label).join('|');
  const stopped = paused || hovered || focused;
  useEffect(()=>{
    if (stopped) { setOutgoing(null); return; }
    const timer = setTimeout(()=>{
      const ids = fieldIds.split('|');
      setOutgoing(field);
      setCurrentId(ids[(ids.indexOf(field.label) + 1) % ids.length]);
    },6000);
    return ()=>clearTimeout(timer);
  },[stopped,fieldIds,field.label,field.value]);
  useEffect(()=>{
    if (!outgoing) return;
    const timer = setTimeout(()=>setOutgoing(null),800);
    return ()=>clearTimeout(timer);
  },[outgoing]);
  const rolling = outgoing && !stopped && outgoing.label !== field.label;
  return <div className={`capture-status ${status}`} role="group" aria-label="Session setup"
    onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}>
    <span className="visually-hidden" role="status">{phase}</span>
    <button type="button" aria-haspopup="dialog" className="setup-summary-item"
      title={field.detail || `${field.label}: ${field.value}`}
      aria-label={`${field.label}: ${field.detail || field.value}`}
      aria-describedby="setup-summary-help" onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      onKeyDown={event=>{
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        setOutgoing(null);
        const index = fields.indexOf(field);
        setCurrentId(fields[(index + (event.key === 'ArrowRight' ? 1 : fields.length - 1)) % fields.length].label);
      }} onClick={()=>onOpen(field.group)}>
      <span className="setup-summary-window">
        {rolling && <span key={`out:${outgoing.label}`} className="setup-summary-row is-outgoing" aria-hidden="true"><span>{outgoing.label}:</span> <strong>{outgoing.value}</strong></span>}
        <span key={field.label} className={`setup-summary-row${rolling ? ' is-incoming' : ''}`}><span>{field.label}:</span> <strong>{field.value}</strong></span>
      </span>
    </button>
    <span id="setup-summary-help" className="visually-hidden">Settings rotate automatically. Hover or focus to pause. Use left and right arrow keys to browse settings, or activate to edit.</span>
  </div>;
}
