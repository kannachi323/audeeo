import {openControlPopup, controlSnapshot, supportsDetachedControls, warmControlPopup} from "../lib/controlPopup";
import {languageName} from "../../shared/languages";
import {useEffect, useLayoutEffect, useRef, useState, type ComponentProps} from 'react';
import {AudioLines, BookOpenText, Mic, Monitor, Languages, Volume2, Timer, ChevronDown} from 'lucide-react';
import {AudioControls, type ControlGroup} from './AudioControls';
import {Button} from './Button';
import {systemAudioLabel} from '../lib/platform';

type Props = Omit<ComponentProps<typeof AudioControls>, 'group'> & {
  open: ControlGroup | null;
  setOpen: (group: ControlGroup | null) => void;
  detached?: boolean;
};
const names = {context:'Translation context', input:'Input source', languages:'Languages & caption mode', audio:'Audio mix', silence:'Silence protection'};
const labels = {context:'Context', input:'Input', languages:'Language', audio:'Audio', silence:'Silence'};
export function CaptionToolbar(props: Props) {
  const {open,setOpen} = props;
  const mobile = props.platform === 'ios' || props.platform === 'android';
  const root = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [popoverLeft,setPopoverLeft] = useState(0);
  const triggers = useRef<Partial<Record<ControlGroup, HTMLButtonElement | null>>>({});
  const detached=supportsDetachedControls(props.platform) && props.detached !== false;
  useEffect(()=>{if(detached)void warmControlPopup(props.platform).catch(()=>{});},[detached,props.platform]);
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
  useLayoutEffect(() => {
    if (!open || detached || mobile || !root.current || !dialog.current) return;
    const place = () => {
      const toolbar = root.current?.querySelector<HTMLElement>('.toolbar-buttons');
      const trigger = triggers.current[open];
      if (!toolbar || !trigger || !dialog.current) return;
      const toolbarRect = toolbar.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const width = dialog.current.getBoundingClientRect().width;
      setPopoverLeft(Math.max(0, Math.min(toolbarRect.width - width,
        triggerRect.left + triggerRect.width / 2 - toolbarRect.left - width / 2)));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root.current);
    observer.observe(dialog.current);
    return () => observer.disconnect();
  }, [open,detached,mobile]);
  const language = languageName;
  const titles = {
    context: `Context: ${props.translationContext.category === 'general' ? 'General' : props.translationContext.category.replaceAll('-', ' ')}`,
    input: `Input source: ${props.input === 'mixed' ? `Microphone + ${props.captureSourceId === 'all' ? systemAudioLabel(props.platform) : 'selected application'}` : props.input === 'system' ? (props.captureSourceId === 'all' ? systemAudioLabel(props.platform) : 'Selected application') : 'Microphone (your input)'}`,
    languages: `${props.captionMode === 'subtitles' ? 'Subtitles' : 'Translation'}: ${language(props.source)}${props.captionMode === 'translate' ? ` → ${language(props.target)}` : ''}`,
    audio: `${props.inputMix ? `Model input — microphone: ${props.microphoneMuted ? 'muted' : `${Math.round(props.microphoneGain*100)}%`}; desktop: ${props.desktopMuted ? 'muted' : `${Math.round(props.desktopGain*100)}%`}. ` : ''}${props.translatedPlayback ? `Translated output: ${props.translatedMuted ? 'muted' : `${Math.round(props.translatedVolume*100)}%`}` : 'Spoken translation unavailable'}`,
    silence: `Auto-stop: ${props.silence.timeoutSeconds}s below ${props.silence.thresholdDbfs} dBFS`,
  };
  const icons = {context: BookOpenText, input: props.input === 'mixed' ? AudioLines : props.input === 'system' ? Monitor : Mic, languages: Languages, audio: Volume2, silence: Timer};
  return <footer ref={root} className="session-footer compact-toolbar">
    <div className="toolbar-buttons" role="toolbar" aria-label="Caption controls">
      {(Object.keys(names) as ControlGroup[]).map(group => {
        const Icon = icons[group];
        return <Button key={group} ref={el=>{triggers.current[group]=el;}} className="icon-button toolbar-island" aria-label={names[group]} title={titles[group]} aria-haspopup="dialog" aria-expanded={open===group} aria-controls={open===group && !detached ? 'caption-control-popover' : undefined} onClick={()=>setOpen(open===group ? null : group)}><Icon/><span>{labels[group]}</span><ChevronDown className="toolbar-chevron" aria-hidden="true"/></Button>;
      })}
    </div>
    {open && !detached && <div ref={dialog} tabIndex={-1} id="caption-control-popover" role="dialog" aria-label={names[open]} className={`control-popover control-${open}`} style={mobile ? undefined : {marginLeft:popoverLeft}}>
      <AudioControls {...props} group={open}/>
    </div>}
  </footer>;
}
