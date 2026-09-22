import { ScanLine, LoaderCircle } from "lucide-react";
import { Select } from "./Select";
import { Button } from "./Button";
import { contextCategoryOptions, contextSize, formatTranslationTerms, parseTerms, parseTranslationTerms, sessionContext, type SessionContext } from "../../shared/context";

export function ContextSettings({value,onChange,active,onFillFromScreen,screenCapturePending=false,screenCaptureIssue="",refillContextSessions=[],onRefillContextFromSession,refillContextStatus='ready'}:{value:SessionContext;onChange:(value:SessionContext)=>void;active:boolean;onFillFromScreen?:()=>void;screenCapturePending?:boolean;screenCaptureIssue?:string;refillContextSessions?:readonly {id:string;label:string;disabled?:boolean}[];refillContextStatus?:'loading'|'ready'|'error';onRefillContextFromSession?:(id:string)=>void}) {
  const set = (next: SessionContext) => {
    if (contextSize(next) <= 10000) onChange({...sessionContext(next), ...(next.customCategory !== undefined ? {customCategory:next.customCategory} : {})});
  };
  return <section className="context-settings" aria-label="Translation context">
    <div className="context-screen-field">
      <Button className="context-screen-button" disabled={active||screenCapturePending||!onFillFromScreen} onClick={onFillFromScreen}>
        {screenCapturePending ? <LoaderCircle className="busy-icon" aria-hidden="true"/> : <ScanLine aria-hidden="true"/>}
        {screenCapturePending ? "Reading screen…" : "Fill from screen"}
      </Button>
      <Select label="Refill from session" value="__refill__" disabled={active||screenCapturePending||!onRefillContextFromSession}
        onChange={id=>onRefillContextFromSession?.(id)} options={[
          {value:'__refill__',label:'Refill from session',disabled:true},
          ...refillContextSessions.map(item=>({value:item.id,label:item.label,disabled:item.disabled})),
          ...(!refillContextSessions.length ? [{value:'__empty__',label:refillContextStatus==='loading' ? 'Loading sessions…' : refillContextStatus==='error' ? 'Could not load sessions — reopen to retry' : 'No history sessions yet',disabled:true}] : []),
        ]}/>
    </div>
    {screenCaptureIssue && <p className="context-screen-error" role="alert">{screenCaptureIssue}</p>}
    <label>Category<Select label="Context category" value={value.category} disabled={active||screenCapturePending} onChange={category=>set({...value,category})} options={contextCategoryOptions}/></label>
    {value.category === "custom" && <label>Custom category<input aria-label="Custom category" disabled={active||screenCapturePending} value={value.customCategory || ""} maxLength={160} onChange={event=>set({...value,customCategory:event.target.value})}/></label>}
    <label>Additional context<textarea aria-label="Additional context" disabled={active||screenCapturePending} value={value.text} maxLength={10000} onChange={event=>set({...value,text:event.target.value})}/></label>
    <label>Names and terms<textarea aria-label="Names and terms" disabled={active||screenCapturePending} value={value.terms.join("\n")} onChange={event=>set({...value,terms:parseTerms(event.target.value)})}/></label>
    <label>Preferred translations<textarea aria-label="Preferred translations" disabled={active||screenCapturePending} value={formatTranslationTerms(value.translationTerms)} onChange={event=>set({...value,translationTerms:parseTranslationTerms(event.target.value)})}/></label>
  </section>;
}
