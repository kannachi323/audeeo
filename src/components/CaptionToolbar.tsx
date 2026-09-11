import {openControlPopup, controlSnapshot, supportsDetachedControls, warmControlPopup} from "../lib/controlPopup";
import {languageName} from "../../shared/languages";
import {useEffect, useRef, type ComponentProps} from 'react';
import {Mic, Monitor, Languages, Volume2, Timer, Play, Square, LoaderCircle} from 'lucide-react';
import {AudioControls, type ControlGroup} from './AudioControls';
import {Button} from './Button';
import type {SessionPhase} from '../lib/presentation';

type Props = Omit<ComponentProps<typeof AudioControls>, 'group'> & {
  open: ControlGroup | null;
  setOpen: (group: ControlGroup | null) => void;
  status: SessionPhase;
  playing: boolean;
  startDisabled: boolean;
  onToggle: () => void;
  detached?: boolean;
};
const names = {input:'Input source', languages:'Languages & caption mode', audio:'Audio mix', silence:'Silence protection'};
export function CaptionToolbar(props: Props) {
  const {open,setOpen,status,playing,active,onToggle,startDisabled} = props;
  const root = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const triggers = useRef<Partial<Record<ControlGroup, HTMLButtonElement | null>>>({});
  const detached=supportsDetachedControls() && props.detached !== false;
  useEffect(()=>{if(detached)void warmControlPopup().catch(()=>{});},[detached]);
  const latest=useRef(props); latest.current=props;
  const popup=useRef<Awaited<ReturnType<typeof openControlPopup>> | undefined>(undefined);
  const serialized=JSON.stringify(controlSnapshot({...props,group:open || 'input'}));
  useEffect(()=>{void popup.current?.send().catch(()=>{});},[serialized]);
  useEffect(()=>{
    if(!open||!detached)return;
    let cancelled=false;
    const controller=new AbortController();
    void openControlPopup(triggers.current[open]!.getBoundingClientRect(),()=>({...latest.current,group:open}),()=>{setOpen(null);triggers.current[open]?.focus();},controller.signal).then(handle=>{
      if(cancelled)handle.dispose();else popup.current=handle;
    }).catch(()=>setOpen(null));
    return ()=>{cancelled=true;controller.abort();popup.current?.dispose();popup.current=undefined;};
  },[open,detached,setOpen]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const outside = (event: PointerEvent) => {
      // The select owns outside dismissal until its menu has closed. Radix
      // can retarget these clicks to the body while outside events are disabled.
      if (document.querySelector('[data-caption-select]')) return;
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[data-caption-select]')) return;
      event.preventDefault(); event.stopPropagation();
      setOpen(null); triggers.current[open]?.focus();
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape,true);
    return () => {document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape,true);};
  }, [open,setOpen]);
  const language = languageName;
  const titles = {
    input: `Input source: ${props.input === 'system' ? 'Device audio' : 'Microphone'}`,
    languages: `${props.captionMode === 'subtitles' ? 'Subtitles' : 'Translation'}: ${language(props.source)}${props.captionMode === 'translate' ? ` → ${language(props.target)}` : ''}`,
    audio: `Original: ${props.sourceMuted ? 'muted' : `${Math.round(props.sourceVolume*100)}%`}; translated: ${props.translatedMuted ? 'muted' : `${Math.round(props.translatedVolume*100)}%`}`,
    silence: `Auto-stop: ${props.silence.timeoutSeconds}s below ${props.silence.thresholdDbfs} dBFS`,
  };
  const icons = {input: props.input === 'system' ? Monitor : Mic, languages: Languages, audio: Volume2, silence: Timer};
  const stateLabel = status === 'connecting' ? 'Connecting' : status === 'stopping' ? 'Finishing captions' : status === 'live' ? 'Listening' : playing ? 'Playing translated audio' : 'Stopped';
  const busy = status === 'connecting' || status === 'stopping';
  return <footer ref={root} className="session-footer compact-toolbar">
    <div className="toolbar-buttons" role="toolbar" aria-label="Caption controls">
      {(Object.keys(names) as ControlGroup[]).map(group => {
        const Icon = icons[group];
        return <Button key={group} ref={el=>{triggers.current[group]=el;}} className="icon-button" aria-label={names[group]} title={titles[group]} aria-haspopup="dialog" aria-expanded={open===group} aria-controls={open===group && !detached ? 'caption-control-popover' : undefined} onClick={()=>setOpen(open===group ? null : group)}><Icon/></Button>;
      })}
      <Button className={`icon-button session-toggle${!active && !busy ? " is-start" : ""}`} aria-label={busy ? stateLabel : active ? 'Stop captions' : 'Start captions'} title={busy ? stateLabel : active ? 'Stop captions' : 'Start captions'} disabled={busy || startDisabled} onClick={()=>{setOpen(null);onToggle();}}>
        {busy ? <LoaderCircle className="busy-icon"/> : active ? <Square/> : <Play/>}
      </Button>
    </div>
    {open && !detached && <div ref={dialog} tabIndex={-1} id="caption-control-popover" role="dialog" aria-label={names[open]} className={`control-popover control-${open}`}>
      <AudioControls {...props} group={open}/>
    </div>}
  </footer>;
}
