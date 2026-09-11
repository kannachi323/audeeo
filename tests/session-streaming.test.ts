import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const setup=vi.hoisted(()=>({upstream:undefined as any}));
vi.mock('../services/session-relay/src/connect',()=>({connectUpstream:async()=>({status:101,webSocket:setup.upstream})}));
vi.mock('../services/session-relay/src/backend',()=>({identity:async()=>({id:'test',expiresAt:Date.now()+3600000}),isDevelopmentUser:()=>true,db:vi.fn(),refreshEntitlement:vi.fn()}));
import relay from '../services/session-relay/src/index';
class Socket {
  sent:any[]=[]; closed=false; handlers=new Map<string,Function[]>();
  accept() {}
  addEventListener(name:string,fn:Function){this.handlers.set(name,[...(this.handlers.get(name)||[]),fn])}
  send(value:string){const event=JSON.parse(value);this.sent.push(event);if(event.type==='session.update')queueMicrotask(()=>void this.emit('message',{data:JSON.stringify({type:'session.updated'})}))}
  close(){this.closed=true}
  async emit(name:string,event:any){for(const fn of this.handlers.get(name)||[])await fn(event)}
  async message(value:any){await this.emit('message',{data: typeof value==='object'&&value instanceof ArrayBuffer?value:JSON.stringify(value)})}
}
let downstream:Socket;
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13'));
  setup.upstream=new Socket();downstream=new Socket();
  vi.stubGlobal('WebSocketPair',class {0=new Socket();1=downstream});
  vi.stubGlobal('Response',class {headers=new Headers(); constructor(_body:any,public options:any){} });
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()});
async function start(target='en', silence?: unknown) {
  await relay.fetch(new Request('https://relay.test/v1/realtime',{headers:{Upgrade:'websocket'}}),{OPENAI_API_KEY:'fake',SUPABASE_SECRET_KEY:'fake'} as any);
  const connecting=downstream.message({type:'start',accessToken:'fake',sourceLanguage:'en',targetLanguage:target,silence});
  await vi.advanceTimersByTimeAsync(0);await connecting;
}
it('streams 60 seconds without periodic commits, then retains final corrections',async()=>{
  await start();
  for(let second=0;second<60;second++){await vi.advanceTimersByTimeAsync(1000);await downstream.message(new Int16Array(16000).fill(1000).buffer);}
  expect(setup.upstream.sent.filter((e:any)=>e.type==='input_audio_buffer.append')).toHaveLength(60);
  expect(setup.upstream.sent.some((e:any)=>e.type==='input_audio_buffer.commit')).toBe(false);
  await setup.upstream.message({type:'conversation.item.input_audio_transcription.delta',item_id:'a',delta:'full text'});
  expect(downstream.sent.at(-1).segment.sourceText).toBe('full text');
  await downstream.message({type:'stop'});
  expect(setup.upstream.sent.at(-1).type).toBe('input_audio_buffer.commit');
  await setup.upstream.message({type:'input_audio_buffer.committed',item_id:'a'});
  expect(downstream.closed).toBe(false);
  await setup.upstream.message({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'corrected full text'});
  expect(downstream.sent.filter(e=>e.type==='segment').at(-1).segment.sourceText).toBe('corrected full text');
  expect(downstream.closed).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('forwards translated PCM through the close drain without creating conversational turns',async()=>{
  await start('zh');
  await downstream.message(new ArrayBuffer(3200));await downstream.message({type:'stop'});
  expect(setup.upstream.sent.at(-1).type).toBe('session.close');expect(downstream.closed).toBe(false);
  await setup.upstream.message({type:'session.output_audio.delta',delta:'AAA=',sample_rate:24000,channels:1,format:'pcm16'});
  expect(downstream.sent.at(-1)).toEqual({type:'audio',pcm:'AAA=',sampleRate:24000});
  await setup.upstream.message({type:'session.output_transcript.delta',delta:'最后'});
  await setup.upstream.message({type:'session.closed'});
  expect(downstream.sent.filter(e=>e.type==='segment').at(-1).segment.translatedText).toBe('最后');
  expect(setup.upstream.sent.some((e:any)=>e.type==='input_audio_buffer.commit'||e.type==='response.create')).toBe(false);
  expect(downstream.closed).toBe(true);expect(vi.getTimerCount()).toBe(0);
});

it.each(['en', 'zh'])('closes %s after 30 seconds of silent PCM and releases every timer', async target => {
  await start(target);
  for (let second = 0; second < 29; second++) {
    await vi.advanceTimersByTimeAsync(1000);
    await downstream.message(new ArrayBuffer(32000));
  }
  expect(downstream.closed).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(setup.upstream.closed).toBe(true);
  expect(downstream.sent.at(-1)).toEqual({type:'finished', reason:'silence timeout'});
  expect(downstream.closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const count = setup.upstream.sent.length;
  await downstream.message(new Int16Array(16000).fill(1000).buffer);
  expect(setup.upstream.sent).toHaveLength(count);
});
it('also closes when capture sends no packets', async () => {
  await start();
  await vi.advanceTimersByTimeAsync(30000);
  expect(downstream.sent.at(-1).reason).toBe('silence timeout');
  expect(setup.upstream.closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('new source activity resets silence without using caption or output events', async () => {
  await start('zh');
  await vi.advanceTimersByTimeAsync(29000);
  await downstream.message(new Int16Array(320).fill(100).buffer);
  await vi.advanceTimersByTimeAsync(29000);
  expect(downstream.closed).toBe(false);
  await setup.upstream.message({type:'session.output_audio.delta',delta:'AAA='});
  await vi.advanceTimersByTimeAsync(1000);
  expect(downstream.sent.at(-1).reason).toBe('silence timeout');
});

it('applies client silence preferences at the relay', async () => {
  await start('zh',{timeoutSeconds:10,thresholdDbfs:-30});
  await vi.advanceTimersByTimeAsync(9000);
  await downstream.message(new Int16Array(320).fill(100).buffer);
  await vi.advanceTimersByTimeAsync(1000);
  expect(downstream.sent.at(-1).reason).toBe('silence timeout');
  expect(setup.upstream.closed).toBe(true);
});
