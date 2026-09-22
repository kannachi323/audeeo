import { afterEach, expect, it, vi } from 'vitest';
import { DirectCaptionClient, type ProviderSocket } from '../src/lib/directCaptions';
import type { Message } from '@tauri-apps/plugin-websocket';
function fixture(provider:'soniox'|'openai'='soniox') {
 let listener:(message:Message)=>void=()=>{};
 const socket:ProviderSocket={addListener:vi.fn(fn=>{listener=fn;return vi.fn();}),send:vi.fn(async()=>{}),disconnect:vi.fn(async()=>{})};
 const factory=vi.fn(async()=>socket),emit=vi.fn();
 const client=new DirectCaptionClient(provider,'private-test-key',emit,factory);
 return {client,socket,factory,emit,event:(data:unknown)=>listener({type:'Text',data:JSON.stringify(data)})};
}
afterEach(()=>vi.useRealTimers());
it('connects Soniox directly without an Audeeo token and drains final captions',async()=>{
 const f=fixture();await f.client.connect('','en','es');
 expect(f.factory.mock.calls[0][0]).toBe('wss://stt-rt.soniox.com/transcribe-websocket');
 expect(JSON.parse(vi.mocked(f.socket.send).mock.calls[0][0] as string).api_key).toBe('private-test-key');
 f.client.sendAudio(new Int16Array([100,200]));
 const stopped=f.client.finish('silence timeout');await Promise.resolve();await Promise.resolve();
 f.event({tokens:[{text:'Hello',is_final:true,translation_status:'original'}],finished:true});await stopped;
 expect(f.emit.mock.calls.some(([e])=>e.type==='segment'&&e.segment.final)).toBe(true);
 expect(f.emit).toHaveBeenLastCalledWith({type:'finished',reason:'silence timeout'});
 expect(f.socket.disconnect).toHaveBeenCalledOnce();
});
it('keeps OpenAI credentials in native headers and waits for session acceptance',async()=>{
 const f=fixture('openai');const connecting=f.client.connect('','en','es');await Promise.resolve();await Promise.resolve();
 expect(f.factory.mock.calls[0]).toEqual(['wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate',{headers:{Authorization:'Bearer private-test-key'}}]);
 expect(f.emit).not.toHaveBeenCalled();f.event({type:'session.updated'});await connecting;
 f.event({type:'error',error:{message:'private-test-key'}});
 expect(JSON.stringify(f.emit.mock.calls)).not.toContain('private-test-key');
});
it('disconnects a socket that arrives after onboarding cancelled connection',async()=>{
 let resolve!:(socket:ProviderSocket)=>void;
 const socket={addListener:vi.fn(),send:vi.fn(),disconnect:vi.fn(async()=>{})};
 const c=new DirectCaptionClient('soniox','key',vi.fn(),()=>new Promise(r=>{resolve=r;}));
 const connecting=c.connect('','en','es');const rejected=expect(connecting).rejects.toThrow('cancelled');
 await c.finish();await rejected;resolve(socket);await Promise.resolve();expect(socket.disconnect).toHaveBeenCalledOnce();expect(socket.send).not.toHaveBeenCalled();
});
it('stops rather than accumulating unbounded audio when a network stalls',async()=>{
 const f=fixture();await f.client.connect('','en','es');
 vi.mocked(f.socket.send).mockImplementation(()=>new Promise(()=>{}));
 for(let i=0;i<10;i++)f.client.sendAudio(new Int16Array(16000));
 expect(f.emit.mock.calls.some(([e])=>e.type==='error'&&e.message.includes('cannot keep up'))).toBe(true);
 expect(f.socket.disconnect).toHaveBeenCalledOnce();
});
