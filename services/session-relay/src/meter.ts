import {db,type Env} from './backend';
type Lease={id:string;seconds:number;rate:1|3;start:number|null;end?:number;checkpoint:number};
/** Reservations are usage seconds; deadlines are wall-clock seconds. */
export class UsageMeter {
 private current?:Lease;
 private remainderMs=0;
 private next?:Lease;
 private chain:Promise<unknown>=Promise.resolve();
 constructor(private env:Env,private owner:string,private session:string,private unlimited=false,private now=Date.now,private environment:'PRODUCTION'|'SANDBOX'='PRODUCTION'){}
 rate:1|3=1;
 allowPacks=false;
 private lock<T>(fn:()=>Promise<T>):Promise<T>{const result=this.chain.then(fn);this.chain=result.catch(()=>{});return result;}
 private async reserve():Promise<Lease>{
  const id=crypto.randomUUID(),rate=this.rate;
  const seconds=this.unlimited?15*rate:Number(await db(this.env,'rpc/reserve_metered_usage',{p_owner:this.owner,p_session:this.session,p_lease:id,p_rate:rate,p_allow_packs:this.allowPacks,p_environment:this.environment}));
  return {id,rate,seconds,start:null,checkpoint:0};
 }
 private weightedMs(l:Lease){return l.start===null?0:Math.min(l.seconds*1000,Math.max(0,(l.end??this.now())-l.start)*l.rate);}
 private consumed(l:Lease){return l.start===null?0:Math.min(l.seconds,Math.floor((this.weightedMs(l)+this.remainderMs)/1000));}
 private async settle(l:Lease,final:boolean){
  const weighted=this.weightedMs(l),seconds=this.consumed(l);
  if(!this.unlimited)await db(this.env,'rpc/settle_metered_usage',{p_owner:this.owner,p_lease:l.id,p_consumed:seconds,p_final:final});
  if(final && !this.unlimited)console.info(JSON.stringify({event:'usage_settled',rate:l.rate,usageSeconds:seconds,activeSeconds:weighted/1000/l.rate,releasedSeconds:l.seconds-seconds}));
  if(final && l.start!==null)this.remainderMs=weighted+this.remainderMs-seconds*1000;
  l.checkpoint=seconds;
 }
 private async release(){
  const old=this.current,next=this.next;this.current=undefined;this.next=undefined;
  if(old)await this.settle(old,true);
  if(next)await this.settle(next,true);
 }
 change(rate:1|3,allowPacks=this.allowPacks,deferStart=false){this.halt();return this.lock(async()=>{
  await this.release();this.rate=rate;this.allowPacks=allowPacks;
  const l=await this.reserve();if(!l.seconds)return false;
  l.start=deferStart?null:this.now();this.current=l;return true;
 });}
 activate(){if(this.current?.start===null)this.current.start=this.now();}
 private advance(){
  const old=this.current;
  if(old && old.start!==null && old.end===undefined && this.now()>=old.start+old.seconds/old.rate*1000 && this.next?.seconds){
   const next=this.next;this.next=undefined;next.start=old.start+old.seconds/old.rate*1000;this.current=next;
   void this.lock(()=>this.settle(old,true));
  }
 }
 get available(){this.advance();return !!this.current && this.current.start!==null && this.current.end===undefined && this.now()<this.current.start+this.current.seconds/this.current.rate*1000;}
 tick(){return this.lock(async()=>{
  const l=this.current;if(!l||l.start===null)return false;
  const remaining=l.start+l.seconds/l.rate*1000-this.now();
  if(remaining<=0){
   await this.settle(l,true);this.current=undefined;
   const next=this.next;this.next=undefined;
   if(!next?.seconds)return false;
   next.start=this.now();this.current=next;
  } else if(remaining<=5000 && !this.next){this.next=await this.reserve();}
  const active=this.current;
  if(active && this.consumed(active)-active.checkpoint>=5*active.rate)await this.settle(active,false);
  return !!this.current;
 });}
 private halt(){if(this.current && this.current.end===undefined)this.current.end=this.now();}
 stop(){this.halt();return this.lock(()=>this.release());}
}
