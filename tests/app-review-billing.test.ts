import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({identity:vi.fn(),db:vi.fn()}));
vi.mock('../services/session-relay/src/backend',async importOriginal=>({...await importOriginal<object>(),identity:mocks.identity,db:mocks.db}));
import relay from '../services/session-relay/src/index';
afterEach(()=>vi.clearAllMocks());

it.each([['reviewer','SANDBOX'],['customer','PRODUCTION']])('confirms %s purchases from the same environment used for balances and sessions',async(owner,environment)=>{
 mocks.identity.mockResolvedValue({id:owner});
 mocks.db.mockResolvedValue([{environment,refunded_at:null,quantity:3}]);
 const response=await relay.fetch(new Request('https://relay.test/v1/purchases/status?transaction=tx&product=audeeo_minutes_60&quantity=3'),{APP_REVIEW_USER_IDS:'reviewer'} as any);
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual({status:'confirmed',environment});
 expect(mocks.db).toHaveBeenCalledWith(expect.anything(),expect.stringContaining(`owner_id=eq.${owner}&environment=eq.${environment}&`),undefined,'GET');
});

it('does not let an ordinary account opt into reviewer purchase confirmation',async()=>{
 mocks.identity.mockResolvedValue({id:'customer'});
 const response=await relay.fetch(new Request('https://relay.test/v1/purchases/status?transaction=tx&product=audeeo_minutes_60',{headers:{'X-Audeeo-Billing-Environment':'sandbox'}}),{APP_REVIEW_USER_IDS:'reviewer'} as any);
 expect(response.status).toBe(403);
 expect(mocks.db).not.toHaveBeenCalled();
});
