import {Select} from "./Select";
import {transcriptionLanguages, translationSources, translationTargets, isTranslationTarget} from "../../shared/languages";
import { ArrowLeftRight, Headphones, Mic, Monitor } from "lucide-react";
import { Button } from "./Button";
import type { Language } from "../../shared/pipeline";
export function Configuration({
  mode, onMode,
  input,
  source,
  active,
  systemAudio,
  save,
  onInput,
  onSource,
  target, onTarget,
  onSave,
}: {
  mode: "subtitles" | "translate";
  onMode: (mode: "subtitles" | "translate") => void;
  input: "microphone" | "system";
  source: Language;
  target: Language;
  onTarget: (target: Language) => void;
  active: boolean;
  systemAudio: boolean;
  save: boolean;
  onInput: (input: "microphone" | "system") => void;
  onSource: (source: Language) => void;
  onSave: (save: boolean) => void;
}) {
  return (
    <section className="settings-body" aria-label="Audio and languages">
      <div className="setting-group">
        <h2>Audio input</h2>
        <div className="input-options">
          <Button
            variant="outline"
            aria-pressed={input === "microphone"}
            disabled={active}
            onClick={() => onInput("microphone")}
          >
            <Mic />
            Microphone
          </Button>
          <Button
            variant="outline"
            aria-pressed={input === "system"}
            disabled={active || !systemAudio}
            onClick={() => onInput("system")}
          >
            <Monitor />
            Device playback
          </Button>
        </div>
        {!systemAudio && (
          <small>Device playback capture isn’t available on this device.</small>
        )}
      </div>
      <div className="setting-group">
        <label>Caption mode<Select label="Caption mode" value={mode} disabled={active} onChange={onMode} options={[{value:'subtitles',label:'Subtitles'},{value:'translate',label:'Translation'}]}/></label>
        <h2>{mode === "subtitles" ? "Caption language" : "Translation direction"}</h2>
        <div className="language-fields">
          <label>Speaker<Select label="Speaker language" value={source} disabled={active} onChange={onSource} options={mode === 'subtitles' ? transcriptionLanguages : translationSources}/></label>
          {mode === 'translate' && <>
            <Button className="icon-button" aria-label="Reverse translation direction" disabled={active || !isTranslationTarget(source)} onClick={()=>{onSource(target);onTarget(source);}}><ArrowLeftRight/></Button>
            <label>Translation<Select label="Translation language" value={target} disabled={active} onChange={onTarget} options={translationTargets.map(option=>({...option,disabled:option.value===source}))}/></label>
          </>}
        </div>
        <small>
          {active
            ? "Stop captions to change the audio input or languages."
            : "Choose a source language or use automatic detection."}
        </small>
      </div>
      <div className="setting-group availability-row">
        <Headphones />
        <div>
          <span>Spoken translation</span>
          <small>
            Not available in this build. Translation is shown as captions.
          </small>
        </div>
        <span className="badge">Off</span>
      </div>
      <div className="setting-group">
        <label className="setting-toggle">
          <span>
            Don’t save this session
            <small>
              Finalized text saves automatically unless you opt out. Audeeo does
              not save raw audio.
            </small>
          </span>
          <input
            type="checkbox"
            checked={!save}
            disabled={active}
            onChange={(e) => onSave(!e.target.checked)}
          />
        </label>
      </div>
    </section>
  );
}
