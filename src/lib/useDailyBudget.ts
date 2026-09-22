import {useEffect, useRef, useState} from 'react';
import {addListeningTime, dailyBudgetKey, normalizeDailyBudget, readDailyBudget, type DailyBudget} from './dailyBudget';

export function useDailyBudget(owner: string | undefined, listening: boolean) {
  const [current,setCurrent] = useState<{owner?:string;value:DailyBudget}>({value:normalizeDailyBudget(null)});
  const [reminder,setReminder] = useState<{owner:string;day:string;minutes:number} | null>(null);
  const valueRef = useRef(current.value);
  const [storageIssue,setStorageIssue] = useState('');
  const persist = (id:string,value:DailyBudget) => {
    try { localStorage.setItem(dailyBudgetKey(id),JSON.stringify(value)); setStorageIssue(''); }
    catch { setStorageIssue('Daily reminder could not be saved on this device.'); }
  };
  useEffect(()=>{
    setReminder(null);
    setStorageIssue('');
    const value = owner ? readDailyBudget(localStorage,owner) : normalizeDailyBudget(null);
    valueRef.current=value;
    setCurrent({owner,value});
  },[owner]);
  useEffect(()=>{
    if (!owner) return;
    let previous = Date.now();
    const tick = () => {
      const now=Date.now();
      let next=listening ? addListeningTime(valueRef.current,previous,now) : normalizeDailyBudget(valueRef.current,new Date(now));
      previous=now;
      if(next.minutes && next.usedSeconds >= next.minutes*60 && next.notifiedMinutes !== next.minutes) {
        const minutes=next.minutes;
        next={...next,notifiedMinutes:next.minutes};
        setReminder({owner,day:next.day,minutes});
      }
      valueRef.current=next;
      persist(owner,next);
      setCurrent({owner,value:next});
    };
    const timer=window.setInterval(tick,5000);
    const visible=()=>{if(document.visibilityState==='visible') tick();};
    window.addEventListener('pagehide',tick);
    document.addEventListener('visibilitychange',visible);
    return ()=>{clearInterval(timer);window.removeEventListener('pagehide',tick);document.removeEventListener('visibilitychange',visible);tick();};
  },[owner,listening]);
  const value = current.owner === owner ? current.value : normalizeDailyBudget(null);
  return {value, storageIssue, reminder:reminder && reminder.owner===owner && reminder.day===value.day ? reminder : null,
    dismiss:()=>setReminder(null),
    setMinutes:(minutes:number|null)=>{
      if(!owner || (minutes!==null && (!Number.isInteger(minutes) || minutes<1 || minutes>1440))) return;
      const next={...normalizeDailyBudget(valueRef.current),minutes,notifiedMinutes:valueRef.current.minutes===minutes ? valueRef.current.notifiedMinutes : null};
      valueRef.current=next;persist(owner,next);setCurrent({owner,value:next});setReminder(null);
    }};
}
