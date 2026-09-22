import {useEffect,useRef,useState} from 'react';
import {Button} from './Button';

export function DailyBudgetDialog({minutes,onApply,onClose}:{minutes:number|null;onApply:(minutes:number|null)=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [draft,setDraft]=useState(String(minutes ?? 60));
  useEffect(()=>{dialog.current?.showModal();},[]);
  const close=()=>{dialog.current?.close();onClose();};
  const valid=Number.isInteger(Number(draft)) && Number(draft)>=1 && Number(draft)<=1440;
  return <dialog ref={dialog} className="daily-budget-dialog" aria-labelledby="daily-budget-title" onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>e.stopPropagation()}>
    <form onSubmit={e=>{e.preventDefault();if(valid){onApply(Number(draft));close();}}}>
      <h2 id="daily-budget-title">Daily reminder</h2>
      <p>A reminder on this device. Sessions continue when you reach it.</p>
      <label htmlFor="daily-budget-minutes">Daily budget <span className="daily-budget-input"><input autoFocus id="daily-budget-minutes" aria-label="Daily budget" type="number" min="1" max="1440" step="1" required value={draft} onChange={e=>setDraft(e.target.value)}/> min</span></label>
      <p className="daily-budget-reset">Resets at local midnight.</p>
      <div className="dialog-actions">
        {minutes!==null && <Button onClick={()=>{onApply(null);close();}}>Turn off</Button>}
        <Button onClick={close}>Cancel</Button><Button type="submit" disabled={!valid}>Apply</Button>
      </div>
    </form>
  </dialog>;
}
