import {useAIConsent} from "./AIConsent";
import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { X } from "lucide-react";
import { isTranslationTarget, translationTargets } from "../../shared/languages";
import type { SavedSessionSummary } from "../../shared/intelligence";
import { askSessionQuestion, generateSessionSummary, type HistorySession } from "../lib/account";
import { Button } from "./Button";
import { Select } from "./Select";

const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export function SessionIntelligence({row,session,onSaved,onClose,onSubscription}:{
  row: HistorySession; session: Session; onSaved:(summary:SavedSessionSummary)=>void;
  onClose:()=>void; onSubscription:()=>void;
}) {
  const {requestConsent} = useAIConsent(session.user.id);
  const existing = row.session_summaries?.[0];
  const preferred = existing?.language || row.target_language;
  const [language,setLanguage] = useState(isTranslationTarget(preferred) ? preferred : "en");
  const [instructions,setInstructions] = useState("");
  const [summary,setSummary] = useState(existing);
  const [pending,setPending] = useState(false);
  const [issue,setIssue] = useState("");
  const [question,setQuestion] = useState("");
  const [answers,setAnswers] = useState<Array<{question:string;answer:string;citations:Array<{quote:string;startMs:number}>}>>([]);
  const generate = async () => {
    if (!await requestConsent("analysis")) return;
    setPending(true); setIssue("");
    try { const next = await generateSessionSummary(session,row.id,language,instructions); setSummary(next); onSaved(next); }
    catch (error) { setIssue(error instanceof Error ? error.message : "Analysis failed. Retry."); }
    finally { setPending(false); }
  };
  const ask = async () => {
    const prompt = question.trim(); if (!prompt) return;
    if (!await requestConsent("analysis")) return;
    setPending(true); setIssue("");
    try { const result = await askSessionQuestion(session,row.id,language,prompt); setAnswers(items=>[...items,{question:prompt,...result}]); setQuestion(""); }
    catch (error) { setIssue(error instanceof Error ? error.message : "Question failed. Retry."); }
    finally { setPending(false); }
  };
  const content = summary?.content;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget) onClose();}}>
    <section className="intelligence-dialog" role="dialog" aria-modal="true" aria-label="Session summary">
      <header><strong>{content?.title || "Session summary"}</strong><Button className="icon-button" aria-label="Close summary" onClick={onClose}><X/></Button></header>
      <div className="intelligence-controls">
        <label>Output language<Select label="Summary output language" value={language} onChange={setLanguage} options={translationTargets}/></label>
        <label>Instructions <span>(optional)</span><textarea value={instructions} maxLength={2000} placeholder="What should the summary focus on?" onChange={event=>setInstructions(event.target.value)}/></label>
        <Button variant="outline" disabled={pending} onClick={()=>void generate()}>{pending ? "Working…" : content ? "Regenerate" : "Generate"}</Button>
      </div>
      {issue && <div className="intelligence-error" role="alert"><p>{issue}</p>{/subscribe|minute pack/i.test(issue) && <div><Button onClick={onSubscription}>View plans & packs</Button></div>}</div>}
      {content && <div className="intelligence-result">
        <p className="summary-recap">{content.recap}</p>
        {!!content.keyPoints.length && <section><h3>Key points</h3><ul>{content.keyPoints.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
        {!!content.notableTerms.length && <section><h3>Terms</h3><dl>{content.notableTerms.map(item=><div key={item.term}><dt>{item.term}</dt><dd>{item.explanation}</dd></div>)}</dl></section>}
        {!!content.actionItems.length && <section><h3>Action items</h3><ul>{content.actionItems.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
        {!!content.chapters.length && <section><h3>Chapters</h3>{content.chapters.map(item=><div className="chapter" key={`${item.startMs}-${item.title}`}><time>{time(item.startMs)}</time><p><strong>{item.title}</strong><br/>{item.summary}</p></div>)}</section>}
        {!!content.quotations.length && <section><h3>Notable quotations</h3>{content.quotations.map((item,index)=><blockquote key={index}><time>{time(item.startMs)}</time> “{item.text}”</blockquote>)}</section>}
        <section className="session-qa"><h3>Ask this session</h3>{answers.map((item,index)=><article key={index}><strong>{item.question}</strong><p>{item.answer}</p>{item.citations.map((citation,c)=><blockquote key={c}><time>{time(citation.startMs)}</time> “{citation.quote}”</blockquote>)}</article>)}<div><input aria-label="Question about session" value={question} maxLength={2000} placeholder="Ask about the transcript" onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==="Enter") void ask();}}/><Button disabled={pending||!question.trim()} onClick={()=>void ask()}>Ask</Button></div></section>
      </div>}
    </section>
  </div>;
}
