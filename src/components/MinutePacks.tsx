import {forwardRef,useImperativeHandle,useEffect,useRef,useState} from 'react';
import {AccountLoading} from './AccountLoading';
import type {Session} from '@supabase/supabase-js';
import {minutePackOffers,purchaseMinutePack} from '../lib/subscriptions';
import {syncSubscriptionUsage,packPurchaseStatus} from '../lib/account';
import {minutePacks, type MinutePackOffer} from '../../shared/minutePacks';
import type {AccountUsage} from '../../shared/billing';
import {Button} from './Button';
import {config} from '../lib/config';
export type MinutePacksHandle={refresh:()=>Promise<void>};
export const MinutePacks=forwardRef<MinutePacksHandle,{session:Session;platform:string;disabled?:boolean;onSynced?:(usage:AccountUsage)=>void}>(function MinutePacks({session,platform,disabled=false,onSynced},ref){

 const key=`audeeo.pending-pack.${session.user.id}${config.billingEnvironment==='sandbox'?'.sandbox':''}`;
 const [offers,setOffers]=useState<MinutePackOffer[]>([]),[busy,setBusy]=useState(false),[pending,setPending]=useState<{transactionId:string;productID:string;after:number;quantity?:number}|null>(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}),[message,setMessage]=useState('');
 const [loading,setLoading]=useState(true);
 const [catalogMessage,setCatalogMessage]=useState('');
 const catalogRequest=useRef(0);
 const operation=useRef(false);
 useImperativeHandle(ref,()=>({refresh}));
 const alive=useRef(true),owner=useRef(session.user.id);owner.current=session.user.id;
 const valid=(account:string)=>alive.current&&owner.current===account;
 const remember=(value:typeof pending)=>{if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);setPending(value);};
 async function reconcile(waiting= pending){
  const account=session.user.id;
  const usage=await syncSubscriptionUsage(session);if(!valid(account))return false;
  onSynced?.(usage);
  if(waiting){
   const result=await packPurchaseStatus(session,waiting.transactionId,waiting.productID,waiting.after,waiting.quantity??1);if(!valid(account))return false;
   if(result.status==='pending'){setMessage('Purchase pending.');return false;}
   remember(null);setMessage(result.status==='refunded'?'This purchase was refunded.':'Minutes added.');return true;
  }
  setMessage('');return true;
 }
 async function refresh(){if(operation.current)return;operation.current=true;setBusy(true);try{await reconcile();}catch{if(valid(session.user.id))setMessage('Synchronization unavailable. Retry without purchasing again.');}finally{operation.current=false;if(valid(session.user.id))setBusy(false);}}
 async function dismissCancelled(){
  if(operation.current||!pending||pending.transactionId)return;
  const account=session.user.id;operation.current=true;setBusy(true);
  try{
   const confirmed=await reconcile(pending);
   if(valid(account)&&!confirmed){remember(null);setMessage('');}
  }catch{if(valid(account))setMessage('Could not check the purchase. Try again.');}
  finally{operation.current=false;if(valid(account))setBusy(false);}
 }
 async function loadOffers(){
  const account=session.user.id,request=++catalogRequest.current;
  const current=()=>valid(account)&&request===catalogRequest.current;
  setLoading(true);setCatalogMessage('');
  try{
   const result=await minutePackOffers(session,platform);
   if(current()){
    setOffers(result);
    setCatalogMessage(result.length===minutePacks.length?'':result.length?'Some prices are unavailable.':'Prices are unavailable. Retry to load them.');
   }
  }catch{
   if(current()){setOffers([]);setCatalogMessage('Prices are unavailable. Retry to load them.');}
  }finally{if(current())setLoading(false);}
 }
 useEffect(()=>{
  alive.current=true;setBusy(false);setOffers([]);setMessage('');
  try{setPending(JSON.parse(localStorage.getItem(key)||'null'));}catch{setPending(null);}
  void loadOffers();
  return()=>{alive.current=false;catalogRequest.current++;};
 },[session.user.id,platform]);

 useEffect(()=>{
  if(!pending)return;
  const check=()=>{if(document.visibilityState==='visible')void refresh();};
  const timer=window.setInterval(check,10000);
  window.addEventListener('focus',check);
  return()=>{clearInterval(timer);window.removeEventListener('focus',check);};
 },[pending,session.user.id,platform]);

 async function buy(offer:MinutePackOffer,quantity:number){
  if(operation.current||pending)return;operation.current=true;const account=session.user.id;setBusy(true);setMessage('');
  // Persist before opening checkout so closing the app cannot cause an accidental second purchase.
  try{
   const before=await syncSubscriptionUsage(session);if(!valid(account))return;
   if(!before.packsEnabled){setMessage('Minute-pack checkout is not enabled yet.');return;}
   const waiting={transactionId:'',productID:offer.productID,after:before.purchaseRevision??0,quantity};remember(waiting);setMessage('Complete checkout in the payment window.');
   const result=await purchaseMinutePack(session,offer.id,platform,quantity);if(!valid(account))return;
   if(result.status==='cancelled'){remember(null);setMessage('');return;}
   if(result.status==='external'){remember(null);setMessage('Complete checkout in your browser, then refresh your balance.');return;}
   const receipt={...waiting,...result};remember(receipt);setMessage('Confirming your minutes…');
   for(let attempt=0;attempt<6;attempt++){if(await reconcile(receipt))return;await new Promise(resolve=>setTimeout(resolve,1500));if(!valid(account))return;}
  }catch(error){if(valid(account))setMessage(localStorage.getItem(key) ? 'Purchase confirmation is pending. Refresh before trying again.' : error instanceof Error ? error.message : 'Could not open checkout. Try again.');}
  finally{operation.current=false;if(valid(account))setBusy(false);}
 }
 return <MinutePackView offers={offers} loading={loading} busy={busy} disabled={disabled} pending={!!pending} message={message} catalogMessage={catalogMessage} onRetry={()=>void loadOffers()} onBuy={(offer,quantity)=>void buy(offer,quantity)} onDismissCancelled={pending&&!pending.transactionId?()=>void dismissCancelled():undefined}/>;
});
/** Shared purchase screen used by setup, Account, and review screenshots. */
export function MinutePackView({offers,loading=false,busy=false,disabled=false,pending=false,message='',catalogMessage='',onRetry,onBuy,onDismissCancelled}:{offers:MinutePackOffer[];loading?:boolean;busy?:boolean;disabled?:boolean;pending?:boolean;message?:string;catalogMessage?:string;onRetry?:()=>void;onBuy:(offer:MinutePackOffer,quantity:number)=>void;onDismissCancelled?:()=>void}){
 const [selected,setSelected]=useState('minutes_60'),[quantity,setQuantity]=useState(1);
 const offer=offers.find(item=>item.id===selected)??offers[0];
 const maxQuantity=Math.max(1,Math.min(10,offer?.pricesByQuantity?.length??1));
 const count=Math.min(quantity,maxQuantity);
 const totalPrice=offer?.pricesByQuantity?.[count-1]??offer?.price;
 const locked=disabled||busy||pending||loading;
 return <section className="settings-panel minute-packs" aria-label="Minute packs" aria-busy={busy||loading}>
  <div className="minute-packs-heading"><h3>Minute packs</h3></div>
  {loading ? <AccountLoading kind="packs" label="Loading minute packs…"/> : <div className="minute-pack-options" role="group" aria-label="Pack size">{minutePacks.map(pack=>{
   const option=offers.find(item=>item.id===pack.id);
   return <div className="minute-pack-option" key={pack.id}><Button aria-label={`${pack.minutes} usage minutes · ${option?.price??'Price unavailable'}`} aria-pressed={offer?.id===pack.id} variant="outline" disabled={!option||locked} onClick={()=>setSelected(pack.id)}><span>{pack.minutes.toLocaleString()} min</span><span className="pack-price">{option?.price??'Unavailable'}</span></Button></div>;
  })}</div>}
  {!loading && (catalogMessage || offers.length<minutePacks.length) && <div className="minute-pack-catalog-status"><p className="visually-hidden" role="status">{catalogMessage||'Some prices are unavailable.'}</p>{onRetry&&<Button disabled={disabled||busy} onClick={onRetry}>Retry prices</Button>}</div>}
  {!loading&&offer&&<div className="pack-checkout">
   {maxQuantity>1&&<div className="pack-count"><span id="pack-quantity-label">Quantity</span><div className="pack-stepper" role="group" aria-labelledby="pack-quantity-label">
    <Button aria-label="Decrease quantity" disabled={locked||count===1} onClick={()=>setQuantity(count-1)}>−</Button>
    <output aria-label="Pack quantity" aria-live="polite">{count}</output>
    <Button aria-label="Increase quantity" disabled={locked||count===maxQuantity} onClick={()=>setQuantity(count+1)}>+</Button>
   </div></div>}
   <div className="pack-checkout-action">{count>1&&<output aria-label="Total price" aria-live="polite">{totalPrice}</output>}<Button className="pack-buy" variant="default" disabled={locked} onClick={()=>onBuy(offer,count)}>{busy&&<span className="button-spinner" aria-hidden="true"/>}Buy</Button></div>
  </div>}
  {pending&&!busy&&onDismissCancelled&&<Button className="pack-check-purchase" onClick={onDismissCancelled} disabled={disabled}>Dismiss cancelled checkout</Button>}
  {pending&&!message&&<p className="visually-hidden" role="status">Purchase pending.</p>}
  {message&&<p className="visually-hidden" role="status">{message}</p>}
 </section>;
}
