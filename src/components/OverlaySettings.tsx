import { RotateCcw } from "lucide-react";
import { Button } from "./Button";
import { Select } from "./Select";
import { MAX_OVERLAY_WIDTH, MIN_OVERLAY_WIDTH, defaultOverlayAppearance, overlayFontStacks, type OverlayAppearance, type OverlayFont } from "../lib/overlayAppearance";

const fonts: readonly {value: OverlayFont; label: string}[] = [
  {value: "system", label: "System"}, {value: "sans", label: "Sans serif"},
  {value: "serif", label: "Serif"}, {value: "mono", label: "Monospace"},
];

function Range({id, label, value, min, max, step = 1, suffix = "", onChange}: {
  id: string; label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  return <div className="appearance-field">
    <div className="setting-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{Math.round(value / step) * step}{suffix}</output></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event=>onChange(Number(event.target.value))}/>
  </div>;
}

function Color({id, label, value, onChange}: {id:string; label:string; value:string; onChange:(value:string)=>void}) {
  return <label className="color-field" htmlFor={id}><span>{label}</span><span className="color-value">{value}<input id={id} type="color" value={value} onChange={event=>onChange(event.target.value)}/></span></label>;
}

export function OverlaySettings({appearance, setAppearance, showSource, setShowSource, autoHide, setAutoHide, opaque, setOpaque}: {
  appearance: OverlayAppearance;
  setAppearance: (value: OverlayAppearance) => void;
  showSource: boolean; setShowSource: (value: boolean) => void;
  autoHide: boolean; setAutoHide: (value: boolean) => void;
  opaque: boolean; setOpaque: (value: boolean) => void;
}) {
  const set = <K extends keyof OverlayAppearance>(key: K, value: OverlayAppearance[K]) => setAppearance({...appearance, [key]: value});
  const percent = (key: "backgroundOpacity"|"borderOpacity"|"textOpacity"|"controlsOpacity"|"overlayOpacity", value:number) => set(key, value / 100);
  return <section className="settings-body overlay-settings" aria-label="Overlay appearance">
    <div className="setting-group overlay-preview-group">
      <div className="setting-heading"><h2>Preview</h2><Button aria-label="Reset overlay appearance" onClick={()=>setAppearance(defaultOverlayAppearance)}><RotateCcw/>Reset</Button></div>
      <div className="appearance-preview" style={{
        backgroundColor: `${appearance.backgroundColor}${Math.round(appearance.backgroundOpacity*255).toString(16).padStart(2,"0")}`,
        borderColor: `${appearance.borderColor}${Math.round(appearance.borderOpacity*255).toString(16).padStart(2,"0")}`,
        borderWidth: appearance.borderWidth, borderRadius: appearance.borderRadius,
        color: appearance.textColor, opacity: appearance.overlayOpacity,
        fontFamily: overlayFontStacks[appearance.fontFamily], fontSize: appearance.fontSize,
        fontWeight: appearance.fontWeight,
      }}><span style={{opacity:appearance.textOpacity}}>Every word, clearly.</span></div>
    </div>
    <div className="setting-group appearance-section">
      <h2>Panel</h2>
      <Range id="panel-width" label="Window width" value={appearance.panelWidth} min={MIN_OVERLAY_WIDTH} max={MAX_OVERLAY_WIDTH} step={20} suffix="px" onChange={value=>set("panelWidth",value)}/>
      <Color id="panel-color" label="Background color" value={appearance.backgroundColor} onChange={value=>set("backgroundColor",value)}/>
      <Range id="panel-opacity" label="Background opacity" value={appearance.backgroundOpacity*100} min={0} max={100} suffix="%" onChange={value=>percent("backgroundOpacity",value)}/>
      <Range id="overlay-opacity" label="Entire overlay opacity" value={appearance.overlayOpacity*100} min={0} max={100} suffix="%" onChange={value=>percent("overlayOpacity",value)}/>
      <Range id="corner-radius" label="Corner radius" value={appearance.borderRadius} min={0} max={40} suffix="px" onChange={value=>set("borderRadius",value)}/>
    </div>
    <div className="setting-group appearance-section">
      <h2>Border</h2>
      <Range id="border-width" label="Width" value={appearance.borderWidth} min={0} max={8} suffix="px" onChange={value=>set("borderWidth",value)}/>
      <Color id="border-color" label="Color" value={appearance.borderColor} onChange={value=>set("borderColor",value)}/>
      <Range id="border-opacity" label="Opacity" value={appearance.borderOpacity*100} min={0} max={100} suffix="%" onChange={value=>percent("borderOpacity",value)}/>
    </div>
    <div className="setting-group appearance-section">
      <h2>Captions</h2>
      <Color id="caption-color" label="Translation color" value={appearance.textColor} onChange={value=>set("textColor",value)}/>
      <Color id="source-caption-color" label="Original color" value={appearance.sourceTextColor} onChange={value=>set("sourceTextColor",value)}/>
      <Range id="text-opacity" label="Text opacity" value={appearance.textOpacity*100} min={0} max={100} suffix="%" onChange={value=>percent("textOpacity",value)}/>
      <Range id="caption-size" label="Size" value={appearance.fontSize} min={18} max={48} suffix="px" onChange={value=>set("fontSize",value)}/>
      <Range id="font-weight" label="Weight" value={appearance.fontWeight} min={300} max={800} step={100} onChange={value=>set("fontWeight",value)}/>
      <label className="font-field">Font<Select label="Caption font" value={appearance.fontFamily} onChange={value=>set("fontFamily",value)} options={fonts}/></label>
    </div>
    <div className="setting-group appearance-section">
      <h2>Controls</h2>
      <Range id="controls-opacity" label="Controls opacity" value={appearance.controlsOpacity*100} min={0} max={100} suffix="%" onChange={value=>percent("controlsOpacity",value)}/>
      <label className="setting-toggle"><span>Hide controls while listening</span><input type="checkbox" checked={autoHide} onChange={event=>setAutoHide(event.target.checked)}/></label>
      <label className="setting-toggle"><span>Show original language</span><input type="checkbox" checked={showSource} onChange={event=>setShowSource(event.target.checked)}/></label>
      <label className="setting-toggle"><span>Reduce transparency</span><input type="checkbox" checked={opaque} onChange={event=>setOpaque(event.target.checked)}/></label>
    </div>
  </section>;
}
