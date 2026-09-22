import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({fetch:vi.fn(),owner:'owner-a'}));
vi.mock('../src/lib/config',()=>({config:{supabaseUrl:'https://history.test',supabasePublishableKey:'test-key'}}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn()}));
vi.mock('@supabase/supabase-js',async()=>{
  const {PostgrestClient}=await import('@supabase/postgrest-js');
  const client=new PostgrestClient('https://history.test/rest/v1',{fetch:mock.fetch});
  return {createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:mock.owner}}}})},from:client.from.bind(client)})};
});
import {listHistory} from '../src/lib/account';
beforeEach(()=>{mock.fetch.mockReset();mock.owner='owner-a';});
const records=Array.from({length:205},(_,i)=>({id:`session-${i}`,started_at:'2026-09-15T22:00:00Z',summary_title:`Session ${i}`,source_language:'zh',target_language:'en'}));
function serveHistory() {
  mock.fetch.mockImplementation(async(input:string)=>{
    const url=new URL(input),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit'));
    expect(url.searchParams.get('owner_id')).toBe('eq.owner-a');
    expect(url.searchParams.get('deleted_at')).toBe('is.null');
    expect(url.searchParams.get('order')).toBe('started_at.desc,id.desc');
    expect(limit).toBe(100);
    return new Response(JSON.stringify(records.slice(offset,offset+limit)),{status:200,headers:{'Content-Type':'application/json'}});
  });
}
it('fetches all history pages for refill without the 100-session display limit',async()=>{
  serveHistory();
  const rows=await listHistory('owner-a',{all:true});
  expect(rows).toHaveLength(205);
  expect(rows.at(-1)?.summary_title).toBe('Session 204');
  expect(mock.fetch).toHaveBeenCalledTimes(3);
});
it('keeps the existing History screen page size and refuses a different account',async()=>{
  serveHistory();
  expect(await listHistory('owner-a')).toHaveLength(100);
  expect(mock.fetch).toHaveBeenCalledOnce();
  await expect(listHistory('owner-b',{all:true})).rejects.toThrow('original account');
  expect(mock.fetch).toHaveBeenCalledOnce();
});
it('reports a failed later page instead of presenting a partial list as all history',async()=>{
  serveHistory();
  mock.fetch.mockImplementationOnce(async()=>new Response(JSON.stringify(records.slice(0,100)),{status:200}));
  mock.fetch.mockImplementationOnce(async()=>new Response(JSON.stringify({message:'History unavailable'}),{status:403}));
  await expect(listHistory('owner-a',{all:true})).rejects.toMatchObject({message:'History unavailable'});
});
