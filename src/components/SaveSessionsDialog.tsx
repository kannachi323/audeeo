import {useEffect,useId,useRef} from 'react';
import {Button} from './Button';

export function SaveSessionsDialog({enabled,pending,issue,onCancel,onConfirm}:{enabled:boolean;pending:boolean;issue:string;onCancel:()=>void;onConfirm:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),title=useId(),description=useId();
  useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="save-sessions-dialog" aria-labelledby={title} aria-describedby={description}
    onCancel={event=>{event.preventDefault();if(!pending)onCancel();}}>
    <h2 id={title}>{enabled ? 'Save sessions?' : 'Turn off Save sessions?'}</h2>
    <p id={description}>{enabled ? 'Sessions are saved for 30 days, then automatically deleted.' : 'Turning off Save sessions will immediately delete your saved sessions, summaries, and reusable context. This cannot be undone. Would you like to continue?'}</p>
    {issue && <p role="alert">{issue}</p>}
    <div className="save-sessions-dialog-actions">
      <Button autoFocus disabled={pending} onClick={onCancel}>Cancel</Button>
      <Button variant="outline" disabled={pending} onClick={onConfirm}>{pending ? 'Updating…' : enabled ? 'Enable Save sessions' : 'Delete history and turn off'}</Button>
    </div>
  </dialog>;
}
