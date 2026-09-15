import {CaptureStatus} from "../../src/components/CaptureStatus";
// Visual QA only. Production controls and layout; no authentication/network/capture.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AudioLines,Settings2} from 'lucide-react';
import {LiveCaptions} from '../../src/components/LiveCaptions';
import {CaptionToolbar} from '../../src/components/CaptionToolbar';
import type {ControlGroup} from '../../src/components/AudioControls';
import '../../src/styles.css';
function Fixture() {
  const [input,setInput]=useState<'microphone'|'system'|'mixed'>('mixed'),[captionMode,setCaptionMode]=useState<'subtitles'|'translate'>('translate'),[source,setSource]=useState<string>('en');
  const [microphoneGain,setMicrophoneGain]=useState(1),[desktopGain,setDesktopGain]=useState(1),[translatedVolume,setTranslatedVolume]=useState(1),[microphoneMuted,setMicrophoneMuted]=useState(false),[desktopMuted,setDesktopMuted]=useState(false),[translatedMuted,setTranslatedMuted]=useState(false);
  const [silence,setSilence]=useState({timeoutSeconds:30,thresholdDbfs:-60});
  const [open,setOpen]=useState<ControlGroup|null>(null);
  const [size,setSize]=useState(40),[width,setWidth]=useState(400),[error,setError]=useState(false);
  const [target,setTarget]=useState('zh');
  const overlay = new URLSearchParams(location.search).has('overlay');
  const style = {width,height:248, ...(overlay ? {
    '--overlay-background':'rgba(20, 60, 80, 0.2)', '--overlay-border':'#00ccff', '--overlay-border-width':'2px',
    '--overlay-radius':'0px', '--overlay-font':'monospace', '--overlay-opacity':'.8',
    '--overlay-text-opacity':'.7', '--overlay-font-weight':'500', '--overlay-source-text':'#ffffaa',
    '--overlay-text':'#aaffff', '--overlay-controls-opacity':'.4',
  } : {})} as React.CSSProperties;
  return <><label>Fixture width <input type="range" min="360" max="700" value={width} onChange={e=>setWidth(+e.target.value)}/></label><label>Caption size<input type="range" min="18" max="40" value={size} onChange={e=>setSize(+e.target.value)}/></label><label>Fixture error<input type="checkbox" checked={error} onChange={e=>setError(e.target.checked)}/></label><main className={`subtitle-panel ${overlay ? 'custom-overlay' : ''} ${open ? "popover-open" : ""}`} style={style}>
    <header className="panel-header"><CaptureStatus input={input} status="idle" playing={false} platform="browser"/><div className="header-actions"><button className="button icon-button" aria-label="Show audio overlay"><AudioLines/></button><button className="button icon-button" aria-label="Open settings"><Settings2/></button></div></header>
    <div className="page-content"><LiveCaptions source={'An earlier sentence. '.repeat(80)+'The newest source text stays readable.'} translation={'这是之前的字幕。'.repeat(80)+'最后的字幕始终清晰可见。'} sourceLanguage={source} targetLanguage={target} size={size}/></div>
    {error && <div className="notice" role="alert">Stopped after silence to save usage. Press Start to resume.</div>}
    <CaptionToolbar {...{input,setInput,captionMode,setCaptionMode,source,setSource,target,setTarget,microphoneGain,setMicrophoneGain,microphoneMuted,setMicrophoneMuted,desktopGain,setDesktopGain,desktopMuted,setDesktopMuted,translatedVolume,setTranslatedVolume,translatedMuted,setTranslatedMuted,silence,setSilence,open,setOpen}} active={false} systemAudio applicationAudio={false} platform="browser" captureSourceId="all" setCaptureSourceId={()=>{}} inputMix translatedPlayback translationContext={{category:'general',text:'',terms:[],translationTerms:[]}} setTranslationContext={()=>{}}/>
  </main></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
