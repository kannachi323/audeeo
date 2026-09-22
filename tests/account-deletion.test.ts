import {afterEach,expect,it,vi} from 'vitest';
import {deleteAccount} from '../services/session-relay/src/accountDeletion';
import type {Env} from '../services/session-relay/src/backend';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',REVENUECAT_SECRET_KEY:'billing-secret',APPLE_CLIENT_ID:'service-id',APPLE_CLIENT_SECRET:'apple-secret'} as Env;
afterEach(()=>vi.unstubAllGlobals());
const reply=(value:unknown={},status=200)=>new Response(JSON.stringify(value),{status});
function api(user:Record<string,unknown>,failBilling=false,claims={sub:'apple-user',aud:'service-id',iss:'https://appleid.apple.com',exp:Math.floor(Date.now()/1000)+3600}) {
  const fetcher=vi.fn(async(input:string,init?:RequestInit)=>{
    if(input.endsWith('/auth/v1/user'))return reply(user);
    if(input.endsWith('/auth/token'))return reply({id_token:`header.${btoa(JSON.stringify(claims))}.signature`});
    if(input.includes('api.revenuecat.com') && failBilling)return reply({},503);
    return reply();
  });vi.stubGlobal('fetch',fetcher);return fetcher;
}
it('requests provider deletion before removing the identity',async()=>{
  const fetcher=api({id:'user'});await deleteAccount(env,'user','access');
  const calls=fetcher.mock.calls.map(([url,init])=>`${init?.method || 'GET'} ${url}`);
  expect(calls.indexOf('DELETE https://api.revenuecat.com/v1/subscribers/user')).toBeLessThan(calls.indexOf('DELETE https://test.supabase.co/auth/v1/admin/users/user'));
});
it('does not delete the identity if billing cleanup fails',async()=>{
  const fetcher=api({id:'user'},true);await expect(deleteAccount(env,'user','access')).rejects.toThrow('Billing');
  expect(fetcher.mock.calls.some(([url,init])=>url.includes('/admin/users/')&&init?.method==='DELETE')).toBe(false);
});
it('requires Apple credentials and rejects a token for another Apple account before mutation',async()=>{
  const fetcher=api({id:'user',identities:[{provider:'apple',identity_data:{sub:'different'}}]});
  await expect(deleteAccount(env,'user','access','refresh-token')).rejects.toThrow('does not match');
  expect(fetcher.mock.calls.some(([,init])=>init?.method==='PUT'||init?.method==='DELETE')).toBe(false);
});
it('stores a digest, revokes Apple, then removes billing and identity',async()=>{
  const fetcher=api({id:'user',identities:[{provider:'apple',identity_data:{sub:'apple-user'}}]});
  await deleteAccount(env,'user','access','refresh-token');
  const marked=fetcher.mock.calls.find(([,init])=>init?.method==='PUT')![1]!;
  expect(String(marked.body)).not.toContain('refresh-token');
  expect(JSON.parse(String(marked.body)).app_metadata.audeeo_deletion.tokenHash).toHaveLength(64);
  const revoked=fetcher.mock.calls.find(([url])=>url.endsWith('/auth/revoke'))!;
  expect(String(revoked[1]?.body)).toContain('token_type_hint=refresh_token');
});
it('can retry after Apple revocation without attempting to refresh a revoked token',async()=>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('refresh-token'));
  const tokenHash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
  const fetcher=api({id:'user',identities:[{provider:'apple',identity_data:{sub:'apple-user'}}],app_metadata:{audeeo_deletion:{appleSubject:'apple-user',tokenHash}}});
  await deleteAccount(env,'user','access','refresh-token');
  expect(fetcher.mock.calls.some(([url])=>url.endsWith('/auth/token'))).toBe(false);
  expect(fetcher.mock.calls.some(([url])=>url.endsWith('/auth/revoke'))).toBe(true);
});
