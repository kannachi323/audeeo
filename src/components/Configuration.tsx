import {Select} from "./Select";
import {transcriptionLanguages, translationSources, translationTargets, isTranslationTarget} from "../../shared/languages";
import { ArrowLeftRight, Headphones, Mic, Monitor } from "lucide-react";
import { Button } from "./Button";
import type { Language } from "../../shared/pipeline";
import { systemAudioDescription, systemAudioLabel } from "../lib/platform";
export function Configuration({
  mode, onMode,
  input,
  source,
  active,
  systemAudio,
  platform = "browser",
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
  platform?: string;
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
            Microphone (your input)
          </Button>
          <Button
            variant="outline"
            aria-pressed={input === "system"}
            disabled={active || !systemAudio}
            onClick={() => onInput("system")}
          >
            <Monitor />
            {systemAudioLabel(platform)}
          </Button>
        </div>
        <small>{systemAudioDescription(platform)}</small>
      </div>
      <div className="setting-group">
        <label>Caption mode<Select label="Caption mode" value={mode} disabled={active} onChange={onMode} options={[{value:'subtitles',label:'Captions'},{value:'translate',label:'Translation'}]}/></label>
        <h2>{mode === "subtitles" ? "Caption language" : "Translation direction"}</h2>
        <div className="language-fields">
          <label>Speaker<Select label="Speaker language" value={source} disabled={active} onChange={onSource} options={mode === 'subtitles' ? transcriptionLanguages : translationSources}/></label>
          {mode === 'translate' && <>
            <Button className="icon-button" aria-label="Reverse translation direction" disabled={active || !isTranslationTarget(source)} onClick={()=>{onSource(target);onTarget(source);}}><ArrowLeftRight/></Button>
            <label>Translation<Select label="Translation language" value={target} disabled={active} onChange={onTarget} options={translationTargets.map(option=>({...option,disabled:option.value===source}))}/></label>
          </>}
        </div>
        {active && <small>Stop captions to change these settings.</small>}
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
