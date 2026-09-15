import { useState } from "react";
import { Link2, WandSparkles } from "lucide-react";
import { Select } from "./Select";
import { Button } from "./Button";
import { contextCategoryOptions, contextSize, formatTranslationTerms, parseTerms, parseTranslationTerms, sessionContext, type SessionContext } from "../../shared/context";

export function ContextSettings({value,onChange,active,onFillFromLink}:{value:SessionContext;onChange:(value:SessionContext)=>void;active:boolean;onFillFromLink?:(url:string)=>Promise<SessionContext>}) {
  const [url,setURL] = useState(""), [pending,setPending] = useState(false), [issue,setIssue] = useState("");
  const set = (next: SessionContext) => {
    if (contextSize(next) <= 10000) onChange(sessionContext(next));
  };
  return <section className="context-settings" aria-label="Translation context">
    <div className="context-link-field"><Link2 aria-hidden="true"/><input aria-label="Link for translation context" inputMode="url" value={url} disabled={active||pending} placeholder="YouTube or public link" onChange={event=>setURL(event.target.value)}/><Button aria-label="Fill context from link" title="Fill with AI" disabled={active||pending||!url.trim()||!onFillFromLink} onClick={()=>{setPending(true);setIssue("");void onFillFromLink?.(url.trim()).then(result=>{onChange(result);setURL("");}).catch(error=>setIssue(error instanceof Error?error.message:"Could not read this link.")).finally(()=>setPending(false));}}>{pending?"Reading…":<><WandSparkles aria-hidden="true"/>Fill</>}</Button></div>
    {issue && <p className="context-link-error" role="alert">{issue}</p>}
    <label>Category<Select label="Context category" value={value.category} disabled={active} onChange={category=>set({...value,category})} options={contextCategoryOptions}/></label>
    <label>Additional context<textarea aria-label="Additional context" disabled={active} value={value.text} maxLength={10000} placeholder="Topic, speakers, background, or translation preferences" onChange={event=>set({...value,text:event.target.value})}/></label>
    <label>Names and terms<textarea aria-label="Names and terms" disabled={active} value={value.terms.join("\n")} placeholder="One term per line" onChange={event=>set({...value,terms:parseTerms(event.target.value)})}/></label>
    <label>Preferred translations<textarea aria-label="Preferred translations" disabled={active} value={formatTranslationTerms(value.translationTerms)} placeholder="source = preferred translation" onChange={event=>set({...value,translationTerms:parseTranslationTerms(event.target.value)})}/></label>
    <output className="context-count" aria-live="polite">{contextSize(value).toLocaleString()} / 10,000</output>
  </section>;
}
