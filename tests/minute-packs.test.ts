import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../services/session-relay/src/backend',()=>({db:vi.fn()}));
import {db} from '../services/session-relay/src/backend';
import {UsageMeter} from '../services/session-relay/src/meter';
import {applyPackEvent,reconcilePackPurchases,synchronizePackPurchases} from '../services/session-relay/src/packs';
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
it.each([[1,60],[3,180]] as const)('meters 60 active seconds at %sx as %s usage seconds',async(rate,expected)=>{
 let now=1_000_000;const calls:any[]=[];
 vi.mocked(db).mockImplementation(async(_env,path,body:any)=>{calls.push({path,body});return path==='rpc/reserve_metered_usage'?body.p_rate*15:undefined;});
 const meter=new UsageMeter({} as any,'owner','session',false,()=>now);await meter.change(rate);
 for(let i=0;i<60;i++){now+=1000;void meter.available;await meter.tick();}
 await meter.stop();
 expect(calls.filter(c=>c.path==='rpc/settle_metered_usage'&&c.body.p_final).reduce((sum,c)=>sum+c.body.p_consumed,0)).toBe(expected);
});
it('settles the previous rate before changing and releases unused reservations',async()=>{
 let now=10000;const charges:number[]=[];
 vi.mocked(db).mockImplementation(async(_env,path,b:any)=>{if(path==='rpc/reserve_metered_usage')return b.p_rate*15;if(b.p_final)charges.push(b.p_consumed);});
 const m=new UsageMeter({} as any,'owner','session',false,()=>now);await m.change(1);now+=30000; // bounded to reserved time when no heartbeat runs
 await m.change(3);now+=10000;await m.stop();expect(charges).toEqual([15,30]);
});
it('requires consent before reserving purchased minutes',async()=>{
 vi.mocked(db).mockResolvedValue(0);const m=new UsageMeter({} as any,'owner','session');await m.change(1);
 expect(vi.mocked(db).mock.calls[0][2]).toMatchObject({p_allow_packs:false});await m.change(3,true);
 expect(vi.mocked(db).mock.calls.at(-1)?.[2]).toMatchObject({p_rate:3,p_allow_packs:true});
});
it('grants only the purchase owner, preserving transaction and sandbox identity',async()=>{
 await applyPackEvent({} as any,{id:'event',type:'NON_RENEWING_PURCHASE',app_user_id:'11111111-1111-4111-8111-111111111111',aliases:['22222222-2222-4222-8222-222222222222'],product_id:'audeeo_minutes_60',transaction_id:'txn',store:'APP_STORE',environment:'SANDBOX',purchased_at_ms:1000});
 expect(db).toHaveBeenCalledTimes(1);expect(vi.mocked(db).mock.calls[0][2]).toMatchObject({p_store:'app_store',p_environment:'SANDBOX',p_transaction:'txn',p_refunded:false});
});
it('does not accept unknown packs or malformed purchase identities',async()=>{
 expect(await applyPackEvent({} as any,{id:'e',type:'NON_RENEWING_PURCHASE',app_user_id:'x',product_id:'unknown'})).toBe(false);
 await expect(applyPackEvent({} as any,{id:'e',type:'NON_RENEWING_PURCHASE',app_user_id:'x',product_id:'audeeo_minutes_60'})).rejects.toThrow();expect(db).not.toHaveBeenCalled();
});
it('charges 120 usage seconds for 30 seconds in each mode',async()=>{
 let now=1000;let total=0;
 vi.mocked(db).mockImplementation(async(_e,path,b:any)=>{if(path==='rpc/reserve_metered_usage')return b.p_rate*15;if(b.p_final)total+=b.p_consumed;});
 const m=new UsageMeter({} as any,'owner','session',false,()=>now);
 await m.change(1);for(let i=0;i<30;i++){now+=1000;void m.available;await m.tick();}
 await m.change(3);for(let i=0;i<30;i++){now+=1000;void m.available;await m.tick();}
 await m.stop();expect(total).toBe(120);
});
it('carries fractional seconds across repeated toggles and excludes connection setup',async()=>{
 let now=1000,total=0;
 vi.mocked(db).mockImplementation(async(_e,path,b:any)=>{if(path==='rpc/reserve_metered_usage')return b.p_rate*15;if(b.p_final)total+=b.p_consumed;});
 const m=new UsageMeter({} as any,'owner','session',false,()=>now);
 await m.change(1,false,true);now+=8000;expect(m.available).toBe(false);m.activate();
 for(let i=0;i<10;i++){now+=100;await m.change(i%2===0?3:1);}
 await m.stop();expect(total).toBe(2);
});
it('refunds the original wallet after an account alias changes, and normalizes Apple stores',async()=>{
 vi.mocked(db).mockImplementation(async(_e,path)=>path.startsWith('minute_pack_purchases?')?[{owner_id:'original-owner'}]:undefined);
 await applyPackEvent({} as any,{id:'refund',type:'CANCELLATION',app_user_id:'22222222-2222-4222-8222-222222222222',product_id:'audeeo_minutes_60',transaction_id:'txn',store:'MAC_APP_STORE',environment:'PRODUCTION',purchased_at_ms:1000});
 expect(vi.mocked(db).mock.calls.at(-1)?.[2]).toMatchObject({p_owner:'original-owner',p_store:'app_store',p_refunded:true});
});

it('treats a new RevenueCat customer as an empty wallet but rejects authorization failures',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:404}));vi.stubGlobal('fetch',fetch);
 const env={REVENUECAT_V2_SECRET_KEY:'server-secret',REVENUECAT_PROJECT_ID:'project'} as any;
 await expect(synchronizePackPurchases(env,'new-owner')).resolves.toBeUndefined();expect(db).not.toHaveBeenCalled();
 fetch.mockResolvedValue(new Response('{}',{status:403}));await expect(synchronizePackPurchases(env,'new-owner')).rejects.toThrow();
});
it('recovers verified bulk store transactions once per original owner, without trusting alias customer IDs',async()=>{
 const owner='11111111-1111-4111-8111-111111111111';
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:'rc',customer_id:owner,original_customer_id:owner,product_id:'product',quantity:3,status:'owned',store_purchase_identifier:'apple-tx',store:'mac_app_store',environment:'sandbox',purchased_at:1000},{id:'alias',customer_id:owner,original_customer_id:'22222222-2222-4222-8222-222222222222',product_id:'product',quantity:1,status:'owned',store_purchase_identifier:'other-tx',store:'app_store',environment:'sandbox',purchased_at:1000}]}))).mockResolvedValueOnce(new Response(JSON.stringify({store_identifier:'audeeo_minutes_60'})));vi.stubGlobal('fetch',fetch);
 await synchronizePackPurchases({REVENUECAT_V2_SECRET_KEY:'secret',REVENUECAT_PROJECT_ID:'project'} as any,owner);
 const grants=vi.mocked(db).mock.calls.filter(call=>call[1]==='rpc/apply_minute_purchase');
 expect(grants).toHaveLength(1);expect(grants[0][2]).toMatchObject({p_owner:owner,p_transaction:'apple-tx',p_environment:'SANDBOX',p_store:'app_store',p_quantity:3});
});

it('restores the current wallet without failing on another account’s old Apple consumables',async()=>{
 const owner='11111111-1111-4111-8111-111111111111';
 vi.mocked(db).mockImplementation(async(_env,path)=>path.includes('transaction_id=eq.old-tx')?[{owner_id:'22222222-2222-4222-8222-222222222222'}]:[]);
 await reconcilePackPurchases({} as any,owner,{audeeo_minutes_60:[
  {store_transaction_id:'old-tx',store:'mac_app_store',purchase_date:'2026-09-16T00:00:00Z',is_sandbox:true},
  {store_transaction_id:'new-tx',store:'app_store',purchase_date:'2026-09-16T01:00:00Z',is_sandbox:true},
 ]});
 const grants=vi.mocked(db).mock.calls.filter(call=>call[1]==='rpc/apply_minute_purchase');
 expect(grants).toHaveLength(1);expect(grants[0][2]).toMatchObject({p_owner:owner,p_transaction:'new-tx'});
});

it.each([true,false])('applies a verified quantity correction only to its recorded wallet: %s',async ownsLedger=>{
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 vi.mocked(db).mockImplementation(async(_env,path)=>path.startsWith('minute_pack_purchases?')?[{owner_id:ownsLedger?owner:other}]:undefined);
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:'rc',customer_id:owner,original_customer_id:other,product_id:'product',quantity:2,status:'owned',store_purchase_identifier:'apple-tx',store:'app_store',environment:'sandbox',purchased_at:1000}]}))).mockResolvedValueOnce(new Response(JSON.stringify({store_identifier:'audeeo_minutes_60'})));vi.stubGlobal('fetch',fetch);
 await synchronizePackPurchases({REVENUECAT_V2_SECRET_KEY:'secret',REVENUECAT_PROJECT_ID:'project'} as any,owner);
 const grants=vi.mocked(db).mock.calls.filter(call=>call[1]==='rpc/apply_minute_purchase');
 expect(grants).toHaveLength(ownsLedger?1:0);
 if(ownsLedger)expect(grants[0][2]).toMatchObject({p_owner:owner,p_quantity:2,p_transaction:'apple-tx'});
});

it('reserves sandbox seconds explicitly for the entire metered session',async()=>{
 vi.mocked(db).mockResolvedValue(15);
 const meter=new UsageMeter({} as any,'tester','session',false,Date.now,'SANDBOX');
 await meter.change(1,false,true);
 await meter.change(3,true,true);
 const reservations=vi.mocked(db).mock.calls.filter(call=>call[1]==='rpc/reserve_metered_usage');
 expect(reservations).toHaveLength(2);
 for(const call of reservations)expect(call[2]).toMatchObject({p_environment:'SANDBOX'});
 await meter.stop();
});

it.each([0,-1,11,1.5])('rejects invalid store quantity %s',async quantity=>{
 await expect(applyPackEvent({} as any,{id:'event',type:'NON_RENEWING_PURCHASE',app_user_id:'11111111-1111-4111-8111-111111111111',product_id:'audeeo_minutes_60',transaction_id:'tx',store:'APP_STORE',environment:'SANDBOX',purchased_at_ms:1000,quantity})).rejects.toThrow('Invalid minute pack quantity');
 expect(db).not.toHaveBeenCalled();
});
