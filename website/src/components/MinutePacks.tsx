import {config} from '../lib/config';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {getMinutePacks,buyMinutePack,refreshMinuteBalance,packPurchaseStatus,type MinutePackOffer} from '../lib/subscriptions';
export function MinutePacks({session}:{session:Session}){

 const key=`audeeo.pending-pack.${session.user.id}${config.billingEnvironment==='sandbox'?'.sandbox':''}`;
 const [offers,setOffers]=useState<MinutePackOffer[]>([]),[busy,setBusy]=useState(false),[pending,setPending]=useState<{transactionId:string;productID:string;after:number}|null>(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}),[message,setMessage]=useState('');
 const [balance,setBalance]=useState<number|null>(null);
 const alive=useRef(true),owner=useRef(session.user.id);owner.current=session.user.id;
 const valid=(account:string)=>alive.current&&owner.current===account;
 const remember=(value:typeof pending)=>{if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);setPending(value);};
 async function reconcile(waiting= pending){
  const account=session.user.id;
  const usage=await refreshMinuteBalance(session);if(!valid(account))return false;

  setBalance(usage.sandbox?.purchasedSeconds??usage.purchasedSeconds??0);
  if(waiting){
   const result=await packPurchaseStatus(session,waiting.transactionId,waiting.productID,waiting.after);if(!valid(account))return false;
   if(result.status==='pending'){setMessage('Payment is still processing. Refresh to synchronize; do not purchase again.');return false;}
   remember(null);setMessage(result.status==='refunded'?'This purchase was refunded.':result.environment==='SANDBOX'?'Test purchase confirmed. Sandbox minutes are separate from your live balance.':'Minutes added.');return true;
  }
  setMessage('Balance refreshed.');return true;
 }
 async function refresh(){if(busy)return;setBusy(true);try{await reconcile();}catch{if(valid(session.user.id))setMessage('Synchronization unavailable. Retry without purchasing again.');}finally{if(valid(session.user.id))setBusy(false);}}
 useEffect(()=>{alive.current=true;setBusy(false);setOffers([]);setBalance(null);setMessage('');try{setPending(JSON.parse(localStorage.getItem(key)||'null'));}catch{setPending(null);}let cancelled=false;void getMinutePacks(session).then(result=>{if(!cancelled){setOffers(result);if(!result.length)setMessage('Minute packs are not available for purchase yet.');}}).catch(()=>{if(!cancelled)setMessage('Minute packs are unavailable. Retry shortly.');});return()=>{cancelled=true;alive.current=false;};},[session.user.id]);
 async function buy(offer:MinutePackOffer){
  if(busy||pending)return;const account=session.user.id;setBusy(true);setMessage('');
  // Persist before opening checkout so closing the app cannot cause an accidental second purchase.
  try{
   const before=await refreshMinuteBalance(session);if(!valid(account))return;
   if(!before.packsEnabled){setMessage('Minute-pack checkout is not enabled yet.');return;}
   const waiting={transactionId:'',productID:offer.productID,after:before.purchaseRevision??0};remember(waiting);setMessage('Complete checkout in the payment window.');
   const result=await buyMinutePack(session,offer.id);if(!valid(account))return;
   if(result.status==='cancelled'){remember(null);return;}
   if(result.status==='external'){remember(null);setMessage('Complete checkout in your browser, then refresh your balance.');return;}
   const receipt={...waiting,...result};remember(receipt);setMessage('Confirming your minutes…');
   for(let attempt=0;attempt<6;attempt++){if(await reconcile(receipt))return;await new Promise(resolve=>setTimeout(resolve,1500));if(!valid(account))return;}
  }catch(error){if(valid(account))setMessage(localStorage.getItem(key) ? 'Purchase confirmation is pending. Refresh before trying again.' : error instanceof Error ? error.message : 'Could not open checkout. Try again.');}
  finally{if(valid(account))setBusy(false);}
 }
 return <section className="pricing-card" aria-label="Minute packs"><h2>Minute packs</h2><p className="plan-description">Pay once. Minutes never expire.</p><div className="pricing-actions">{offers.map(p=><button className="button outline" key={p.id} disabled={busy||!!pending} onClick={()=>void buy(p)}>{p.minutes} minutes · {p.price}</button>)}<button className="button outline" disabled={busy} onClick={()=>void refresh()}>Refresh balance</button></div>{balance!==null&&<p>{(balance/60).toFixed(1)} purchased usage minutes</p>}{message&&<p role="status">{message}</p>}</section>;
}
