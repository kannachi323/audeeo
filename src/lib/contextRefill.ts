import type {HistorySession} from './account';
import type {ContextSession} from './contextStorage';
import {hasSessionContext} from '../../shared/context';

export function contextRefillOptions(history: HistorySession[], snapshots: ContextSession[], owner: string) {
  const saved = new Map(snapshots.filter(item=>item.owner===owner).map(item=>[item.id,item]));
  return history.map(row=>{
    const snapshot = saved.get(row.id);
    const title = [row.summary_title, row.session_summaries?.[0]?.content.title, snapshot?.label, row.preview]
      .map(value=>value?.replace(/\s+/g,' ').trim()).find(Boolean) || 'Untitled session';
    const disabled = !snapshot || !hasSessionContext(snapshot.context);
    return {id:row.id,label:`${title}${disabled ? ' (blank)' : ''}`,disabled};
  });
}
