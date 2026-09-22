import type { HistorySession } from './account';
import type { Segment } from '../../shared/pipeline';
const key='audeeo.byok-history.v1';
const retention=30*24*60*60*1000;
export function localHistory(storage:Pick<Storage,'getItem'|'setItem'>,now=Date.now()):HistorySession[] {
  const raw=storage.getItem(key);
  if(!raw)return [];
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows))throw new Error('Local history is unreadable. Export or clear app data before retrying.');
  const retained=rows.filter(row=>row&&typeof row.id==='string'&&Array.isArray(row.segments)&&Date.parse(row.started_at)>now-retention).slice(0,100);
  if(retained.length!==rows.length)write(storage,retained);
  return retained;
}
function write(storage:Pick<Storage,'setItem'>,rows:HistorySession[]) {
  let value=JSON.stringify(rows);
  // Bound local history without silently discarding the current session.
  while(value.length>2_000_000&&rows.length>1){rows.pop();value=JSON.stringify(rows);}
  if(value.length>2_000_000)throw new Error('This session exceeds local history storage. Export it before continuing.');
  storage.setItem(key,value);
}
export function saveLocalSegment(storage:Storage,segment:Segment,startedAt:string) {
  if(!segment.final)return;
  const rows=localHistory(storage);
  let row=rows.find(row=>row.id===segment.sessionId);
  if(!row){row={id:segment.sessionId,started_at:startedAt,source_language:segment.sourceLanguage,target_language:segment.targetLanguage,segments:[],session_summaries:[]};rows.unshift(row);}
  const next={id:segment.id,sequence:segment.sequence,start_ms:segment.startMs,end_ms:segment.endMs,source_text:segment.sourceText,translated_text:segment.translatedText};
  row.segments=[...row.segments.filter(item=>item.id!==segment.id),next].sort((a,b)=>a.sequence-b.sequence);
  row.preview=(segment.translatedText||segment.sourceText).slice(0,180);
  write(storage,rows.slice(0,100));
}
export function deleteLocalSession(storage:Storage,id:string) {write(storage,localHistory(storage).filter(row=>row.id!==id));}
export function clearLocalHistory(storage:Pick<Storage,'removeItem'>) {storage.removeItem(key);}
