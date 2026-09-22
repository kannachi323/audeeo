import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../services/session-relay/src/connect',()=>({connectUpstream:vi.fn()}));
import {connectUpstream} from '../services/session-relay/src/connect';
import {SonioxVoice} from '../services/session-relay/src/sonioxVoice';
class Socket {
 sent:any[]=[];handlers=new Map<string,Function[]>();closed=false;
 accept(){} send(value:string){this.sent.push(JSON.parse(value));}
 addEventListener(name:string,fn:Function){this.handlers.set(name,[...(this.handlers.get(name)??[]),fn]);}
 close(){if(this.closed)return;this.closed=true;this.fire('close',{});}
 fire(name:string,event:any){for(const fn of this.handlers.get(name)??[])fn(event);}
 message(body:any){this.fire('message',{data:JSON.stringify({stream_id:this.sent[0].stream_id,...body})});}
}
let sockets:Socket[];
beforeEach(()=>{vi.useFakeTimers();sockets=[];vi.mocked(connectUpstream).mockImplementation(async()=>{const ws=new Socket();sockets.push(ws);return {status:101,webSocket:ws} as any;});});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.clearAllMocks();});
it('speaks committed utterances in order using Daniel 24 kHz PCM',async()=>{
 const emit=vi.fn(),failed=vi.fn(),voice=new SonioxVoice('server-key','fr',emit,failed);
 voice.speak('Bonjour');voice.speak('Ensuite');await vi.advanceTimersByTimeAsync(0);expect(sockets).toHaveLength(1);
 expect(sockets[0].sent[0]).toMatchObject({model:'tts-rt-v2',voice:'Daniel',sample_rate:24000,audio_format:'pcm_s16le'});
 sockets[0].message({audio:'first',terminated:true});await vi.advanceTimersByTimeAsync(0);expect(sockets).toHaveLength(2);
 expect(sockets[1].sent[1].text).toBe('Ensuite');sockets[1].message({audio:'second',terminated:true});await vi.advanceTimersByTimeAsync(0);
 expect(emit.mock.calls).toEqual([['first'],['second']]);expect(failed).not.toHaveBeenCalled();
});
it('cancels queued text and rejects late audio when voice is switched off',async()=>{
 const emit=vi.fn(),voice=new SonioxVoice('key','fr',emit,vi.fn());voice.speak('one');voice.speak('two');await vi.advanceTimersByTimeAsync(0);
 voice.cancel();sockets[0].message({audio:'late'});await vi.advanceTimersByTimeAsync(0);expect(emit).not.toHaveBeenCalled();expect(sockets).toHaveLength(1);
 voice.speak('new');await vi.advanceTimersByTimeAsync(0);expect(sockets[1].sent[1].text).toBe('new');voice.cancel();
});
it('reports an interrupted stream once and discards its queue',async()=>{
 const failed=vi.fn(),voice=new SonioxVoice('key','fr',vi.fn(),failed);voice.speak('one');voice.speak('two');await vi.advanceTimersByTimeAsync(0);
 sockets[0].close();await vi.advanceTimersByTimeAsync(0);expect(failed).toHaveBeenCalledTimes(1);expect(sockets).toHaveLength(1);
});
it('adapts Chinese script only for the speech provider',async()=>{
 const voice=new SonioxVoice('key','zh',vi.fn(),vi.fn());voice.speak('歡迎');await vi.advanceTimersByTimeAsync(0);expect(sockets[0].sent[1].text).toBe('欢迎');voice.cancel();
});
