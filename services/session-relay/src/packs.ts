import {isMinutePackProduct} from '../../../shared/minutePacks';
import {db,type Env} from './backend';
export type PurchaseEvent = {id:string;type:string;app_user_id:string;product_id?:string;transaction_id?:string;store?:string;environment?:string;purchased_at_ms?:number;quantity?:number;cancel_reason?:string;original_app_user_id?:string;aliases?:string[];transferred_from?:string[];transferred_to?:string[]};
const storeName=(store:string)=>store.toLowerCase()==='mac_app_store'?'app_store':store.toLowerCase();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function recordedOwner(env:Env,store:string,environment:string,transaction:string):Promise<string|undefined> {
 const rows=await db(env,`minute_pack_purchases?store=eq.${encodeURIComponent(storeName(store))}&environment=eq.${encodeURIComponent(environment)}&transaction_id=eq.${encodeURIComponent(transaction)}&select=owner_id`,undefined,'GET');
 return rows?.[0]?.owner_id;
}
/** Only authenticated RevenueCat webhook payloads reach this function. Never grant aliases. */
export async function applyPackEvent(env:Env,event:PurchaseEvent) {
 if(!isMinutePackProduct(event.product_id))return false;
 if(!['NON_RENEWING_PURCHASE','CANCELLATION'].includes(event.type))return true;
 if(!uuid.test(event.app_user_id) || !event.transaction_id || !event.store || !['PRODUCTION','SANDBOX'].includes(event.environment || '') || !Number.isFinite(event.purchased_at_ms))
  throw new Error('Incomplete minute pack purchase');
 if(event.quantity!==undefined&&(!Number.isInteger(event.quantity)||event.quantity<1||event.quantity>10))throw new Error('Invalid minute pack quantity');
 const store=storeName(event.store);
 // Refund the immutable wallet owner even after RevenueCat aliases/transfers the customer.
 const existing=event.type==='CANCELLATION'?await db(env,`minute_pack_purchases?store=eq.${encodeURIComponent(store)}&environment=eq.${event.environment}&transaction_id=eq.${encodeURIComponent(event.transaction_id)}&select=owner_id`,undefined,'GET'):[];
 const owner=existing?.[0]?.owner_id??event.app_user_id;
 await db(env,'rpc/apply_minute_purchase',{p_owner:owner,p_store:store,p_environment:event.environment,
  p_transaction:event.transaction_id,p_product:event.product_id,p_purchased_at:new Date(event.purchased_at_ms!).toISOString(),p_refunded:event.type==='CANCELLATION',p_quantity:event.quantity??null});
 console.info(JSON.stringify({event:'pack_reconciled',product:event.product_id,store,environment:event.environment,refunded:event.type==='CANCELLATION'}));
 return true;
}
/** v1 purchase IDs are not necessarily store transaction IDs. Only reconcile records with the latter. */
export async function reconcilePackPurchases(env:Env,owner:string,purchases:Record<string,Array<{store_transaction_id?:string;store?:string;purchase_date?:string;is_sandbox?:boolean;quantity?:number;refunded_at?:string|null}>>) {
 for(const [product,items] of Object.entries(purchases)) {
  if(!isMinutePackProduct(product))continue;
  for(const p of items) {
   if(!p.store_transaction_id || !p.store || !p.purchase_date || typeof p.is_sandbox!=='boolean')continue;
   // Apple receipts can include consumables belonging to another Audeeo login.
   // Preserve their wallet instead of letting one old receipt fail all restores.
   const existing=await recordedOwner(env,p.store,p.is_sandbox?'SANDBOX':'PRODUCTION',p.store_transaction_id);
   if(existing && existing!==owner)continue;
   await db(env,'rpc/apply_minute_purchase',{p_owner:owner,p_store:storeName(p.store),p_environment:p.is_sandbox?'SANDBOX':'PRODUCTION',p_transaction:p.store_transaction_id,p_product:product,p_purchased_at:p.purchase_date,p_refunded:!!p.refunded_at,p_quantity:p.quantity??null});
  }
 }
}

/** Recover purchases independently of webhook delivery using store transaction identifiers. */
export async function synchronizePackPurchases(env:Env,owner:string) {
 if(!env.REVENUECAT_V2_SECRET_KEY || !env.REVENUECAT_PROJECT_ID)return;
 const prefix=`/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID)}`;
 const get=async(path:string)=>{
  if(!path.startsWith(prefix+'/'))throw new Error('Invalid billing pagination');
  const r=await fetch('https://api.revenuecat.com'+path,{headers:{Authorization:`Bearer ${env.REVENUECAT_V2_SECRET_KEY}`},signal:AbortSignal.timeout(8000)});
  if(r.status===404 && path.startsWith(`${prefix}/customers/`))return {items:[]};
  if(!r.ok)throw new Error('Purchase synchronization unavailable');return r.json() as Promise<any>;
 };
 const products=new Map<string,string>();
 let path:string|null=`${prefix}/customers/${encodeURIComponent(owner)}/purchases?limit=100`;
 for(let page=0;path&&page<100;page++){
  const result=await get(path);
  for(const purchase of result.items??[]){
   // RevenueCat can retain a previous original customer after the Apple account
   // switches Audeeo logins, even for a new purchase. A verified existing ledger
   // owner may receive its quantity correction; another wallet never transfers.
   const purchaser=uuid.test(purchase.original_customer_id??'')?purchase.original_customer_id:purchase.customer_id;
   if(!['owned','refunded'].includes(purchase.status) || (!Number.isInteger(purchase.quantity)||purchase.quantity<1||purchase.quantity>10) || !purchase.store_purchase_identifier || !purchase.store || !['sandbox','production'].includes(purchase.environment))continue;
   const existing=await recordedOwner(env,purchase.store,String(purchase.environment).toUpperCase(),String(purchase.store_purchase_identifier));
   if(existing ? existing!==owner : purchaser!==owner)continue;
   let product=products.get(purchase.product_id);
   if(!product){const info=await get(`${prefix}/products/${encodeURIComponent(purchase.product_id)}`);product=String(info.store_identifier);products.set(purchase.product_id,product);}
   if(!isMinutePackProduct(product))continue;
   await applyPackEvent(env,{id:purchase.id,type:purchase.status==='refunded'?'CANCELLATION':'NON_RENEWING_PURCHASE',app_user_id:owner,product_id:product,transaction_id:String(purchase.store_purchase_identifier),store:purchase.store,environment:String(purchase.environment).toUpperCase(),purchased_at_ms:purchase.purchased_at,quantity:purchase.quantity});
  }
  path=result.next_page;
 }
 if(path)throw new Error('Purchase history synchronization needs another attempt');
}
