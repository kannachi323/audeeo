import {afterEach,expect,it,vi} from 'vitest';
import {accountUsage,billingSandbox,refreshEntitlement} from '../services/session-relay/src/backend';
const env:any={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'server-key',REVENUECAT_SECRET_KEY:'rc-key',REVENUECAT_ENTITLEMENT:'audeeo_pro',BILLING_TEST_USER_IDS:'tester',MINUTE_PACKS_ENABLED:'false'};
const testPlan={store_transaction_id:'test-tx',store:'app_store',is_sandbox:true,purchase_date:'2026-09-01T00:00:00Z',expires_date:'2099-01-01T00:00:00Z'};
function backend(live=false){
 const fetch=vi.fn(async(url:any,_options?:any)=>{
  if(String(url).includes('revenuecat'))return Response.json({subscriber:{original_app_user_id:'tester',entitlements:{audeeo_pro:{product_identifier:'AUDEEO_MONTHLY_1',purchase_date:testPlan.purchase_date,expires_date:testPlan.expires_date}},subscriptions:{AUDEEO_MONTHLY_1:testPlan,...(live?{audeeo_pro_yearly_web:{...testPlan,is_sandbox:false,store_transaction_id:'live-tx',store:'rc_billing'}}:{})}}});
  if(String(url).includes('minute_pack_purchases'))return Response.json([{id:4,remaining_seconds:3600}]);
  if(String(url).includes('sandbox_account_usage'))return Response.json({active:true,unlimited:false,purchasedSeconds:3600,remainingSeconds:36000,includedSeconds:36000,usedSeconds:0,purchaseRevision:4,sandbox:{subscriptionActive:true,purchasedSeconds:3600,productId:'AUDEEO_MONTHLY_1'}});
  if(String(url).includes('account_usage'))return Response.json({active:live,unlimited:false,purchasedSeconds:120,remainingSeconds:0});
  return Response.json(null);
 });vi.stubGlobal('fetch',fetch);return fetch;
}
afterEach(()=>vi.unstubAllGlobals());
it('never grants live subscription minutes from an Apple sandbox receipt',async()=>{
 const fetch=backend();await refreshEntitlement(env,'tester');
 const call=fetch.mock.calls.find(([url])=>String(url).includes('apply_entitlement'))!;
 expect(JSON.parse((call[1] as any).body).p_paid).toBe(false);
});
it('retains an active live subscription when RevenueCat selects a sandbox entitlement',async()=>{
 const fetch=backend(true);await refreshEntitlement(env,'tester');
 const call=fetch.mock.calls.find(([url])=>String(url).includes('apply_entitlement'))!;
 expect(JSON.parse((call[1] as any).body)).toMatchObject({p_paid:true,p_product_id:'audeeo_pro_yearly_web',p_subscription_id:'live-tx'});
});
it('enables tester pack checkout and returns separate sandbox balances without mutating live allowance',async()=>{
 const fetch=backend();const result=await refreshEntitlement(env,'tester',true);
 expect(result).toMatchObject({active:true,remainingSeconds:36000,purchasedSeconds:3600,packsEnabled:true,purchaseRevision:4,sandbox:{subscriptionActive:true,purchasedSeconds:3600,productId:'AUDEEO_MONTHLY_1'}});
 expect(fetch.mock.calls.some(([url])=>String(url).includes('apply_entitlement'))).toBe(false);
 expect(fetch.mock.calls.some(([url])=>String(url).includes('sandbox_account_usage'))).toBe(true);
 const applied=fetch.mock.calls.find(([url])=>String(url).includes('apply_sandbox_entitlement'))!;
 expect(JSON.parse((applied[1] as any).body)).toMatchObject({p_active:true,p_product:'AUDEEO_MONTHLY_1',p_subscription:'test-tx'});
});
it('rejects unapproved sandbox users before contacting billing or the database',async()=>{
 const fetch=backend();await expect(refreshEntitlement(env,'stranger',true)).rejects.toMatchObject({status:403});expect(fetch).not.toHaveBeenCalled();
});
it('keeps live minute-pack checkout disabled for a tester using production mode',async()=>{
 backend();expect((await refreshEntitlement(env,'tester')).packsEnabled).toBe(false);
});
it('lets only dedicated review accounts use verified sandbox purchases from the production binary',async()=>{
 const fetch=backend();const reviewEnv={...env,APP_REVIEW_USER_IDS:' reviewer '};
 const result=await refreshEntitlement(reviewEnv,'reviewer');
 expect(result).toMatchObject({packsEnabled:true,sandbox:{subscriptionActive:true},purchasedSeconds:3600});
 await accountUsage(reviewEnv,'reviewer');
 expect(fetch.mock.calls.some(([url])=>String(url).includes('/rpc/account_usage'))).toBe(false);
 expect(fetch.mock.calls.some(([url])=>String(url).includes('/rpc/apply_entitlement'))).toBe(false);
 expect(fetch.mock.calls.some(([url])=>String(url).includes('/rpc/apply_sandbox_entitlement'))).toBe(true);
 expect(billingSandbox(reviewEnv,'tester')).toBe(false);
 expect(billingSandbox(reviewEnv,'customer')).toBe(false);
 expect(()=>billingSandbox(reviewEnv,'customer',true)).toThrow('Sandbox purchases are not enabled');
 expect(()=>billingSandbox(reviewEnv,'',true)).toThrow('Sandbox purchases are not enabled');
});
