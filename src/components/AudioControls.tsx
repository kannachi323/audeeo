import {Select} from "./Select";
import {transcriptionLanguages, translationSources, translationTargets} from "../../shared/languages";
import type { SilenceSettings } from "../../shared/silence";
import {useEffect, useState, type Dispatch, type SetStateAction} from "react";
import type {Language} from "../../shared/pipeline";
import {Button} from "./Button";
import {Volume2, VolumeX} from "lucide-react";
import {ContextSettings} from "./ContextSettings";
import type {SessionContext} from "../../shared/context";
import {invoke} from "@tauri-apps/api/core";
import {systemAudioDescription, systemAudioLabel, type CaptureApplication, type CaptureSources, type InputMode} from "../lib/platform";
export type ControlGroup = "context" | "input" | "languages" | "audio" | "silence";
export function AudioControls({group, silence, setSilence, input, setInput, active, systemAudio, applicationAudio, platform, captureSourceId, setCaptureSourceId, inputMix, translatedPlayback, captionMode, setCaptionMode, source, setSource, target, setTarget, microphoneGain, setMicrophoneGain, microphoneMuted, setMicrophoneMuted, desktopGain, setDesktopGain, desktopMuted, setDesktopMuted, translatedVolume, setTranslatedVolume, translatedMuted, setTranslatedMuted, translationContext, setTranslationContext, onFillContextFromLink}: {group: ControlGroup; silence: SilenceSettings; setSilence: (value: SilenceSettings)=>void; input: InputMode; setInput:(v:InputMode)=>void; active:boolean; systemAudio:boolean; applicationAudio:boolean; platform:string; captureSourceId:string; setCaptureSourceId:(value:string)=>void; inputMix:boolean; translatedPlayback:boolean;
captionMode:'subtitles'|'translate'; setCaptionMode:(v:'subtitles'|'translate')=>void;
source:Language; setSource:(v:Language)=>void; target:Language; setTarget:(v:Language)=>void;
microphoneGain:number; setMicrophoneGain:(v:number)=>void; microphoneMuted:boolean; setMicrophoneMuted:Dispatch<SetStateAction<boolean>>;
desktopGain:number; setDesktopGain:(v:number)=>void; desktopMuted:boolean; setDesktopMuted:Dispatch<SetStateAction<boolean>>;
translatedVolume:number; setTranslatedVolume:(v:number)=>void; translatedMuted:boolean; setTranslatedMuted:Dispatch<SetStateAction<boolean>>;
translationContext:SessionContext; setTranslationContext:(value:SessionContext)=>void; onFillContextFromLink?:(url:string)=>Promise<SessionContext>;
}) {
  const [applications,setApplications] = useState<CaptureApplication[]>([]);
  const [sourcesPending,setSourcesPending] = useState(false);
  useEffect(()=>{
    if (group !== 'input' || input === 'microphone' || !applicationAudio) return;
    let disposed=false;
    setSourcesPending(true);
    void invoke<CaptureSources>('capture_sources').then(value=>{
      if (!disposed) setApplications(value.captureSources ?? []);
    }).catch(()=>{if(!disposed)setApplications([]);}).finally(()=>{if(!disposed)setSourcesPending(false);});
    return()=>{disposed=true;};
  },[group,input,applicationAudio]);
  const applicationOptions = [
    {value:'all',label:systemAudioLabel(platform)},
    ...applications.map(application=>({value:application.id,label:application.name})),
    ...(captureSourceId !== 'all' && !applications.some(application=>application.id===captureSourceId)
      ? [{value:captureSourceId,label:'Selected application (not currently available)',disabled:true}] : []),
  ];
  const inputOptions: {value:InputMode; label:string; disabled?:boolean}[] = [
    {value:'microphone',label:'Microphone (your input)'},
    {value:'system',label:platform === 'macos' || platform === 'windows' ? 'Desktop audio' : 'Device playback',disabled:!systemAudio},
    ...(inputMix ? [{value:'mixed' as const,label:'Microphone + desktop audio'}] : []),
  ];
  return (<div className="popover-fields">
        {group === "context" && <ContextSettings value={translationContext} onChange={setTranslationContext} active={active} onFillFromLink={onFillContextFromLink}/>}
        {group === "input" && <><label>Input source<Select label="Input source" value={input} disabled={active} onChange={setInput} options={inputOptions}/></label>{input !== 'microphone' && applicationAudio && <label>Playback source<Select label="Playback source" value={captureSourceId} disabled={active || sourcesPending} onChange={setCaptureSourceId} options={applicationOptions}/></label>}<p className="hint">{input === 'mixed' ? (captureSourceId === 'all' ? 'Mixes your microphone with all desktop playback for the caption model.' : 'Mixes your microphone with only the selected application for the caption model.') : input === 'system' ? (captureSourceId === 'all' ? systemAudioDescription(platform) : 'Captures only the selected application. Start playback before selecting it on desktop.') : 'Captures the microphone selected by your operating system.'}</p></>}
        {group === "languages" && <>
          <label>Caption mode<Select label="Caption mode" value={captionMode} disabled={active} onChange={setCaptionMode} options={[{value:'subtitles',label:'Subtitles'},{value:'translate',label:'Translation'}]}/></label>
          <label>Source language<Select label="Source language" value={source} disabled={active} onChange={setSource} options={captionMode === 'subtitles' ? transcriptionLanguages : translationSources}/></label>
          {captionMode === 'translate' && <label>Target language<Select label="Target language" value={target} disabled={active} onChange={setTarget} options={translationTargets.map(option=>({...option,disabled:option.value===source}))}/></label>}
        </>}
        {group === "audio" && <>{inputMix && <><div className="audio-mix"><label>Microphone input<input aria-label="Microphone input gain" aria-valuetext={`${Math.round(microphoneGain*100)} percent`} type="range" min="0" max="1" step="0.05" value={microphoneGain} disabled={input === 'system'} onChange={e=>setMicrophoneGain(Number(e.target.value))}/></label><Button className="icon-button" title={microphoneMuted ? "Unmute microphone input" : "Mute microphone input"} aria-label="Mute microphone input" aria-pressed={microphoneMuted} disabled={input === 'system'} onClick={()=>setMicrophoneMuted(v=>!v)}>{microphoneMuted ? <VolumeX aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}</Button></div>
        <div className="audio-mix"><label>Desktop audio input<input aria-label="Desktop audio input gain" aria-valuetext={`${Math.round(desktopGain*100)} percent`} type="range" min="0" max="1" step="0.05" value={desktopGain} disabled={input === 'microphone'} onChange={e=>setDesktopGain(Number(e.target.value))}/></label><Button className="icon-button" title={desktopMuted ? "Unmute desktop audio input" : "Mute desktop audio input"} aria-label="Mute desktop audio input" aria-pressed={desktopMuted} disabled={input === 'microphone'} onClick={()=>setDesktopMuted(v=>!v)}>{desktopMuted ? <VolumeX aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}</Button></div></>}
        <div className="audio-mix"><label>Translated audio<input aria-label="Translated audio volume" aria-valuetext={`${Math.round(translatedVolume*100)} percent`} type="range" min="0" max="1" step="0.05" value={translatedVolume} disabled={!translatedPlayback} onChange={e=>setTranslatedVolume(Number(e.target.value))}/></label><Button className="icon-button" title={translatedMuted ? "Unmute translated audio" : "Mute translated audio"} aria-label="Mute translated audio" aria-pressed={translatedMuted} disabled={!translatedPlayback} onClick={()=>setTranslatedMuted(v=>!v)}>{translatedMuted ? <VolumeX aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}</Button></div>
        </>}
        {group === "silence" && <><label>Stop after silence · {silence.timeoutSeconds}s<input aria-label="Silence timeout" aria-valuetext={`${silence.timeoutSeconds} seconds`} type="range" min="10" max="300" step="5" value={silence.timeoutSeconds} disabled={active} onChange={e=>setSilence({...silence,timeoutSeconds:Number(e.target.value)})}/></label>
        <label>Silence level · {silence.thresholdDbfs} dBFS<input aria-label="Silence threshold" aria-valuetext={`${silence.thresholdDbfs} dBFS`} type="range" min="-80" max="-30" step="1" value={silence.thresholdDbfs} disabled={active} onChange={e=>setSilence({...silence,thresholdDbfs:Number(e.target.value)})}/></label>
        {active && <p className="hint">Stop the session to adjust.</p>}
        </>}
        {group === 'audio' && inputMix && <p className="hint">Microphone and desktop levels affect only the audio frames sent to captions. They do not change what you hear.</p>}
        {group === 'audio' && input === 'system' && !inputMix && <p className="hint">{platform === 'android' ? 'Android lowers the original while translated speech plays. Original volume stays under the source app.' : 'Original volume stays under the source app or system controls on this device.'}</p>}
        {group === 'audio' && !translatedPlayback && <p className="hint">Spoken translation playback isn’t available on this device yet.</p>}
        {group === 'audio' && input === 'microphone' && translatedPlayback && <p className="hint">Use headphones for translated speech to avoid microphone feedback.</p>}
      </div>); }
