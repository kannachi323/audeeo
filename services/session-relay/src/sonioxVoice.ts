import {simplified} from './chinese';
import {connectUpstream} from './connect';
/** One ordered TTS stream per committed utterance; canceled generations never reach playback. */
export class SonioxVoice {
 private socket?:WebSocket; private generation=0; private pending=0; private queue=Promise.resolve();
 constructor(private key:string,private language:string,private emit:(pcm:string)=>void,private failed:()=>void){}
 speak(text:string){
  if(!text.trim())return;
  const run=this.generation;
  if(++this.pending>16){this.cancel();this.failed();return;}
  this.queue=this.queue.then(async()=>{
   if(run!==this.generation)return;
   try{await this.utterance(text,run);}catch{if(run===this.generation){this.cancel();this.failed();}}
   finally{if(run===this.generation)this.pending--;}
  });
 }
 cancel(){this.generation++;this.pending=0;this.socket?.close();this.socket=undefined;}
 private async utterance(text:string,run:number){
  const r=await connectUpstream('https://tts-rt.soniox.com/tts-websocket',this.key);
  const ws=r.webSocket;if(r.status!==101||!ws)throw new Error('Voice unavailable');
  if(run!==this.generation){ws.close();return;}this.socket=ws;ws.accept();
  await new Promise<void>((resolve,reject)=>{
   let done=false,bytes=0;const id=crypto.randomUUID();
   const end=(error?:Error)=>{if(done)return;done=true;clearTimeout(timeout);ws.close();error?reject(error):resolve();};
   const timeout=setTimeout(()=>end(new Error('Voice timed out')),30000);
   ws.addEventListener('message',event=>{try{
    if(run!==this.generation){end();return;}
    if(typeof event.data!=='string')throw new Error('Invalid voice response');
    const e=JSON.parse(event.data);if(e.stream_id!==id)return;
    if(e.error_code)throw new Error('Voice failed');
    if(e.audio){if(typeof e.audio!=='string'||(bytes+=e.audio.length)>4_000_000)throw new Error('Voice buffer full');this.emit(e.audio);}
    if(e.terminated)end();
   }catch{end(new Error('Voice failed'));}});
   ws.addEventListener('error',()=>end(new Error('Voice connection failed')));
   ws.addEventListener('close',()=>end(run===this.generation?new Error('Voice interrupted'):undefined));
   ws.send(JSON.stringify({api_key:this.key,model:'tts-rt-v2',voice:'Daniel',language:this.language==='zh-cn'?'zh':this.language,audio_format:'pcm_s16le',sample_rate:24000,stream_id:id}));
   ws.send(JSON.stringify({stream_id:id,text:this.language==='zh'||this.language==='zh-cn'?simplified(text):text,text_end:true}));
  });
 }
}
