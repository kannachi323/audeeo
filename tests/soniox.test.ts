import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {SonioxCaptions, sonioxConfig} from '../services/session-relay/src/soniox';
import type {Segment} from '../shared/pipeline';

const result = (tokens: any[]) => ({tokens, final_audio_proc_ms: 500, total_audio_proc_ms: 600});
it('configures native 16 kHz audio, language aliases, auto detection and optional translation', () => {
  expect(sonioxConfig('auto', 'auto')).not.toHaveProperty('language_hints');
  expect(sonioxConfig('en', 'en')).not.toHaveProperty('translation');
  expect(sonioxConfig('cmn', 'en')).toMatchObject({audio_format:'pcm_s16le', sample_rate:16000, num_channels:1, language_hints:['zh'], translation:{type:'one_way',target_language:'en'}});
});
it('replaces provisional snapshots, retains final prefixes and drains late translation', () => {
  const events: Segment[] = [];
  const captions = new SonioxCaptions('test', 'en', 'zh', s => events.push(s));
  captions.ingest(result([{text:'Hello',is_final:true,start_ms:100,end_ms:200},{text:' wrong',is_final:false}]), 600);
  captions.ingest(result([{text:' world.',is_final:true},{text:'你好',is_final:false,translation_status:'translation'}]), 700);
  expect(events.at(-1)).toMatchObject({sourceText:'Hello world.',translatedText:'你好',final:false,startMs:100});
  captions.ingest(result([{text:'你好世界。',is_final:true,translation_status:'translation'}]), 800);
  captions.flush();
  expect(events.at(-1)).toMatchObject({sourceText:'Hello world.',translatedText:'你好世界。',final:true});
  expect(events.map(e => e.id).every(id => id === events[0].id)).toBe(true);
});
it('never promotes an unconfirmed draft on disconnect and filters special tokens', () => {
  const events: Segment[] = [];
  const captions = new SonioxCaptions('test', 'en', 'en', s => events.push(s));
  captions.ingest(result([{text:'Confirmed',is_final:true},{text:' hallucination',is_final:false},{text:'<end>',is_final:true}]), 600);
  captions.flush();
  expect(events.at(-1)).toMatchObject({sourceText:'Confirmed',final:true});
  captions.ingest(result([{text:' next',is_final:true}]), 900);
  expect(events.at(-1)?.sequence).toBe(1);
});

vi.mock('../services/session-relay/src/backend', () => ({identity: async () => ({id:'test',expiresAt:Date.now()+3600000}), isDevelopmentUser:()=>true,db:vi.fn(),refreshEntitlement:vi.fn()}));
import relay from '../services/session-relay/src/index';
class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  binaryType = 'arraybuffer';
  sent: any[] = [];
  closed = false;
  accept() {}
  constructor(public url?: string) { super(); if (url) { upstream = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); } }
  send(value: any) { this.sent.push(typeof value === 'string' && value ? JSON.parse(value) : value); }
  close() { this.closed = true; this.readyState = 3; }
  message(value: any) { this.dispatchEvent(new MessageEvent('message',{data:value instanceof ArrayBuffer ? value : JSON.stringify(value)})); }
}
let upstream: FakeSocket, downstream: FakeSocket;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14'));
  downstream = new FakeSocket();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('WebSocketPair', class {0 = new FakeSocket(); 1 = downstream;});
  vi.stubGlobal('Response', class {headers = new Headers(); constructor(public body: any, public options: any) {} });
});
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();});
async function start(path = '/v1/realtime/soniox', extra = {}) {
  const response = await relay.fetch(new Request(`https://relay.test${path}`,{headers:{Upgrade:'websocket'}}), {SONIOX_API_KEY:'private-soniox-test-key', SUPABASE_SECRET_KEY:'fake', ...extra} as any);
  downstream.message({type:'start',accessToken:'fake',sourceLanguage:'en',targetLanguage:'zh'});
  await vi.advanceTimersByTimeAsync(0);
  return response;
}
it('runs the real SDK through the separate relay route without an OpenAI key', async () => {
  await start();
  expect(upstream.url).toBe('wss://stt-rt.soniox.com/transcribe-websocket');
  expect(upstream.sent[0]).toMatchObject({api_key:'private-soniox-test-key',translation:{type:'one_way',target_language:'zh'}});
  expect(downstream.sent.at(-1).type).toBe('ready');
  const audio = new Int16Array(1600).fill(1000).buffer;
  downstream.message(audio);
  expect(upstream.sent.at(-1)).toEqual(new Uint8Array(audio));
  upstream.message(result([{text:'Hello',is_final:true}]));
  downstream.message({type:'stop'});
  expect(upstream.sent.at(-1)).toBe('');
  expect(downstream.closed).toBe(false);
  upstream.message({...result([{text:'你好',is_final:true,translation_status:'translation'}]),finished:true});
  expect(downstream.sent.filter(e => e.type === 'segment').at(-1).segment).toMatchObject({sourceText:'Hello',translatedText:'你好',final:true});
  expect(downstream.sent.at(-1)).toEqual({type:'finished',reason:'finished'});
  expect(JSON.stringify(downstream.sent)).not.toContain('private-soniox-test-key');
  expect(vi.getTimerCount()).toBe(0);
});
it('selects Soniox via the server setting and closes it on silence', async () => {
  await start('/v1/realtime', {CAPTION_PROVIDER:'soniox'});
  await vi.advanceTimersByTimeAsync(30000);
  expect(upstream.closed).toBe(true);
  expect(downstream.sent.at(-1).reason).toBe('silence timeout');
  expect(vi.getTimerCount()).toBe(0);
});
it('handles provider authentication errors without exposing their raw response', async () => {
  await start();
  upstream.message({error_code:401,error_message:'private-soniox-test-key'});
  expect(downstream.sent.some(e => e.type === 'error' && e.message.includes('Soniox'))).toBe(true);
  expect(JSON.stringify(downstream.sent)).not.toContain('private-soniox-test-key');
  expect(downstream.closed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds finalization time and closes the SDK socket', async () => {
  await start();
  downstream.message({type:'stop'});
  await vi.advanceTimersByTimeAsync(15000);
  expect(upstream.closed).toBe(true);
  expect(downstream.sent.at(-1).reason).toBe('stop timeout');
  expect(vi.getTimerCount()).toBe(0);
});

it('clears a draft-only caption without saving it as a final history record', () => {
  const events: Segment[] = [];
  const captions = new SonioxCaptions('test', 'en', 'en', s => events.push(s));
  captions.ingest(result([{text:'unconfirmed',is_final:false}]), 100);
  captions.flush();
  expect(events.at(-1)).toMatchObject({sourceText:'',translatedText:'',final:false});
});
