import {useEffect,useRef,useState} from 'react';
import {Download,Sparkles,Trash2} from 'lucide-react';
import type {HistorySession} from '../lib/account';
import {Button} from './Button';

/** One owner for action visibility, shared by pointer, touch and keyboard. */
export function HistoryRows({rows,onSummary,onExport,onDelete}:{
  rows:HistorySession[];
  onSummary?:(row:HistorySession)=>void;
  onExport:(row:HistorySession)=>void;
  onDelete:(id:string)=>void;
}) {
  const [activeId,setActiveId]=useState<string|null>(null);
  const list=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const clear=()=>setActiveId(null);
    const outside=(event:PointerEvent)=>{if(!list.current?.contains(event.target as Node))clear();};
    window.addEventListener('blur',clear);
    document.addEventListener('scroll',clear,true);
    document.addEventListener('pointerdown',outside);
    return()=>{
      window.removeEventListener('blur',clear);
      document.removeEventListener('scroll',clear,true);
      document.removeEventListener('pointerdown',outside);
    };
  },[]);
  return <div ref={list} className="history-rows">
    {rows.map(row=><article key={row.id} tabIndex={0} data-actions-active={activeId===row.id}
      onPointerEnter={()=>setActiveId(row.id)}
      onPointerMove={()=>setActiveId(row.id)}
      onPointerDown={()=>setActiveId(row.id)}
      onPointerLeave={event=>{if(event.pointerType!=='touch')setActiveId(current=>current===row.id ? null : current);}}
      onFocus={()=>setActiveId(row.id)}
      onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setActiveId(current=>current===row.id ? null : current);}}
      onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.focus();setActiveId(null);}}}>
      <div className="history-row-copy">
        <strong>{row.summary_title || row.session_summaries?.[0]?.content.title || new Date(row.started_at).toLocaleString()}</strong>
        <p>{row.summary_title ? new Date(row.started_at).toLocaleString() : row.preview || 'Caption session'}</p>
      </div>
      <div className="history-row-actions">
        {activeId===row.id && <>
          {onSummary && <Button aria-label="Summarize session" title={row.summary_title ? 'Open session summary' : 'Summarize session'} onClick={()=>onSummary(row)}><Sparkles/></Button>}
          <Button aria-label="Export session" title="Export text" onClick={()=>onExport(row)}><Download/></Button>
          <Button aria-label="Delete session" title="Delete session" onClick={()=>onDelete(row.id)}><Trash2/></Button>
        </>}
      </div>
    </article>)}
  </div>;
}
