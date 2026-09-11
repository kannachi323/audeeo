import {Select} from "./Select";
import {transcriptionLanguages, translationSources, translationTargets} from "../../shared/languages";
import type { SilenceSettings } from "../../shared/silence";
import type React from "react";
import type {Language} from "../../shared/pipeline";
import {Button} from "./Button";
import {Volume2, VolumeX} from "lucide-react";
export type ControlGroup = "input" | "languages" | "audio" | "silence";
export function AudioControls({group, silence, setSilence, input, setInput, active, systemAudio, captionMode, setCaptionMode, source, setSource, target, setTarget, sourceVolume, setSourceVolume, sourceMuted, setSourceMuted, translatedVolume, setTranslatedVolume, translatedMuted, setTranslatedMuted}: {group: ControlGroup; silence: SilenceSettings; setSilence: (value: SilenceSettings)=>void; input: 'microphone' | 'system'; setInput: (v:'microphone'|'system')=>void; active:boolean; systemAudio:boolean;
captionMode:'subtitles'|'translate'; setCaptionMode:(v:'subtitles'|'translate')=>void;
source:Language; setSource:(v:Language)=>void; target:Language; setTarget:(v:Language)=>void;
sourceVolume:number; setSourceVolume:(v:number)=>void; sourceMuted:boolean; setSourceMuted:React.Dispatch<React.SetStateAction<boolean>>;
translatedVolume:number; setTranslatedVolume:(v:number)=>void; translatedMuted:boolean; setTranslatedMuted:React.Dispatch<React.SetStateAction<boolean>>;
}) { return (<div className="popover-fields">
        {group === "input" && <label>Input source<Select label="Input source" value={input} disabled={active} onChange={setInput} options={[{value:'microphone',label:'Microphone'},{value:'system',label:'Device audio',disabled:!systemAudio}]}/></label>}
        {group === "languages" && <>
          <label>Caption mode<Select label="Caption mode" value={captionMode} disabled={active} onChange={setCaptionMode} options={[{value:'subtitles',label:'Subtitles'},{value:'translate',label:'Translation'}]}/></label>
          <label>Source language<Select label="Source language" value={source} disabled={active} onChange={setSource} options={captionMode === 'subtitles' ? transcriptionLanguages : translationSources}/></label>
          {captionMode === 'translate' && <label>Target language<Select label="Target language" value={target} disabled={active} onChange={setTarget} options={translationTargets.map(option=>({...option,disabled:option.value===source}))}/></label>}
        </>}
        {group === "audio" && <><div className="audio-mix"><label>Original audio<input aria-label="Original audio volume" aria-valuetext={`${Math.round(sourceVolume*100)} percent`} type="range" min="0" max="1" step="0.05" value={sourceVolume} disabled={input !== 'system'} onChange={e=>setSourceVolume(Number(e.target.value))}/></label><Button className="icon-button" title={sourceMuted ? "Unmute original audio" : "Mute original audio"} aria-label="Mute original audio" aria-pressed={sourceMuted} disabled={input !== 'system'} onClick={()=>setSourceMuted(v=>!v)}>{sourceMuted ? <VolumeX aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}</Button></div>
        <div className="audio-mix"><label>Translated audio<input aria-label="Translated audio volume" aria-valuetext={`${Math.round(translatedVolume*100)} percent`} type="range" min="0" max="1" step="0.05" value={translatedVolume} onChange={e=>setTranslatedVolume(Number(e.target.value))}/></label><Button className="icon-button" title={translatedMuted ? "Unmute translated audio" : "Mute translated audio"} aria-label="Mute translated audio" aria-pressed={translatedMuted} onClick={()=>setTranslatedMuted(v=>!v)}>{translatedMuted ? <VolumeX aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}</Button></div>
        </>}
        {group === "silence" && <><label>Stop after silence · {silence.timeoutSeconds}s<input aria-label="Silence timeout" aria-valuetext={`${silence.timeoutSeconds} seconds`} type="range" min="10" max="300" step="5" value={silence.timeoutSeconds} disabled={active} onChange={e=>setSilence({...silence,timeoutSeconds:Number(e.target.value)})}/></label>
        <label>Silence level · {silence.thresholdDbfs} dBFS<input aria-label="Silence threshold" aria-valuetext={`${silence.thresholdDbfs} dBFS`} type="range" min="-80" max="-30" step="1" value={silence.thresholdDbfs} disabled={active} onChange={e=>setSilence({...silence,thresholdDbfs:Number(e.target.value)})}/></label>
        <p className="hint">{active ? 'Stop the session to adjust silence protection.' : 'Auto-stop below this input level. A higher level treats more quiet sound as silence.'}</p>
        </>}
        {group === 'audio' && input === 'microphone'  && <p className="hint">Use headphones for translated speech to avoid microphone feedback.</p>}
      </div>); }
