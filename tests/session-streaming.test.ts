import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({backend:undefined as any,voice:undefined as any,reserve:45}));
vi.mock('../services/session-relay/src/backend',async importOriginal=>({...await importOriginal<object>(),identity:async()=>({id:'test',expiresAt:Date.now()+3600000}),isDevelopmentUser:()=>false,refreshEntitlement:async()=>({active:true}),db:vi.fn(async(_env,path,b)=>path==='rpc/reserve_metered_usage'?Math.min(state.reserve,15*b.p_rate):path.startsWith('session_history_settings')?[]:undefined)}));
vi.mock('../services/session-relay/src/soniox',()=>({SonioxBackend:class {
 captions={flush:vi.fn()};connect=vi.fn(async()=>{});close=vi.fn();sendAudio=vi.fn();finish=vi.fn(async()=>{});
 constructor(...args:any[]){Object.assign(this,{emit:args[4],error:args[5],finished:args[6]});state.backend=this;}
}}));
vi.mock('../services/session-relay/src/sonioxVoice',()=>({SonioxVoice:class {speak=vi.fn();cancel=vi.fn();constructor(...args:any[]){Object.assign(this,{emit:args[2],fail:args[3]});state.voice=this;}}}));
import {liveSession} from '../services/session-relay/src/liveSession';
import {db} from '../services/session-relay/src/backend';
class Socket {
 sent:any[]=[];closed=false;binaryType='blob';handlers=new Map<string,Function[]>();accept(){}
 addEventListener(name:string,fn:Function){this.handlers.set(name,[...(this.handlers.get(name)||[]),fn]);}
 send(s:string){this.sent.push(JSON.parse(s));}close(){this.closed=true;}
 message(data:any){for(const fn of this.handlers.get('message')||[])fn({data:data instanceof ArrayBuffer?data:JSON.stringify(data)});}
}
let socket:Socket;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-16'));vi.clearAllMocks();state.reserve=45;state.voice=undefined;socket=new Socket();vi.stubGlobal('WebSocketPair',class {0=new Socket();1=socket});vi.stubGlobal('Response',class {constructor(_b:any,public options:any){}});});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
async function send(data:any){socket.message(data);await vi.advanceTimersByTimeAsync(0);}
async function start(extra={}){liveSession({SONIOX_API_KEY:'server',MAX_SESSION_SECONDS:'1800'} as any);await send({type:'start',accessToken:'token',sourceLanguage:'en',targetLanguage:'zh',...extra});}
it('uses managed Soniox and forwards audio while metering',async()=>{await start();expect(socket.sent.at(-1).type).toBe('ready');for(let i=0;i<60;i++){await vi.advanceTimersByTimeAsync(1000);await send(new Int16Array(16000).fill(1000).buffer);}expect(state.backend.sendAudio).toHaveBeenCalledTimes(60);});
it('settles before acknowledging a 3x voice change and resets playback when disabled',async()=>{
 await start();await send(new ArrayBuffer(100));await vi.advanceTimersByTimeAsync(2000);await send({type:'voice',enabled:true});
 expect(socket.sent.at(-1)).toMatchObject({type:'billing',rate:3,voiceEnabled:true});
 expect(vi.mocked(db).mock.calls.some(c=>c[1]==='rpc/settle_metered_usage'&&(c[2] as any).p_consumed===2)).toBe(true);
 const segment={id:'one',sessionId:'test',sequence:0,final:false,translatedText:'你好'};state.backend.emit(segment);expect(state.voice.speak).not.toHaveBeenCalled();state.backend.emit({...segment,final:true});expect(state.voice.speak).toHaveBeenCalledWith('你好');
 const voice=state.voice;await send({type:'voice',enabled:false});expect(voice.cancel).toHaveBeenCalled();expect(socket.sent.at(-1)).toMatchObject({type:'billing',rate:1});expect(socket.sent.at(-2).type).toBe('audio_reset');
});
it('voice errors preserve captions and revert to 1x',async()=>{await start({voiceEnabled:true});state.voice.fail();await vi.advanceTimersByTimeAsync(0);expect(socket.sent.at(-1)).toMatchObject({type:'billing',rate:1,voiceEnabled:false});expect(state.backend.close).not.toHaveBeenCalled();});
it('pauses without spending packs and resumes only after consent',async()=>{
 state.reserve=0;await start();expect(socket.sent.at(-1).type).toBe('pack_consent_required');expect(vi.mocked(db).mock.calls.find(c=>c[1]==='rpc/reserve_metered_usage')?.[2]).toMatchObject({p_allow_packs:false});
 await vi.advanceTimersByTimeAsync(60000);expect(socket.closed).toBe(false);
 state.reserve=45;await send({type:'use_packs'});expect(socket.sent.at(-1)).toMatchObject({paused:false,allowPurchasedMinutes:true});
});
it('drains final captions on stop and bounds a stalled provider',async()=>{await start();const backend=state.backend;await send({type:'stop'});expect(backend.finish).toHaveBeenCalled();expect(socket.closed).toBe(false);await vi.advanceTimersByTimeAsync(15000);expect(socket.closed).toBe(true);expect(vi.getTimerCount()).toBe(0);});
it('stops independently after silence and blocks subsequent packets',async()=>{await start();const backend=state.backend;await vi.advanceTimersByTimeAsync(30000);expect(socket.sent.at(-1)).toEqual({type:'finished',reason:'silence timeout'});await send(new ArrayBuffer(100));expect(backend.sendAudio).not.toHaveBeenCalled();});

it('does not charge while waiting for capture permission or the first audio packet',async()=>{
 await start();await vi.advanceTimersByTimeAsync(10000);await send({type:'voice',enabled:true});
 expect(vi.mocked(db).mock.calls.filter(c=>c[1]==='rpc/settle_metered_usage').every(c=>(c[2] as any).p_consumed===0)).toBe(true);
 await send(new ArrayBuffer(100));await vi.advanceTimersByTimeAsync(1000);await send({type:'stop'});
 expect(vi.mocked(db).mock.calls.at(-1)?.[2]).toMatchObject({p_consumed:3,p_final:true});
});
it('exhaustion cancels speech and provider capture before requesting purchased minutes',async()=>{
 state.reserve=3;await start({voiceEnabled:true});await send(new ArrayBuffer(100));const voice=state.voice,backend=state.backend;
 state.reserve=0;await vi.advanceTimersByTimeAsync(1000);
 expect(voice.cancel).toHaveBeenCalled();expect(backend.close).toHaveBeenCalled();expect(socket.sent.at(-1)).toMatchObject({type:'pack_consent_required'});
 const before=backend.sendAudio.mock.calls.length;await send(new ArrayBuffer(100));expect(backend.sendAudio).toHaveBeenCalledTimes(before);
});
