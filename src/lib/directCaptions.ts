import NativeSocket, { type Message } from '@tauri-apps/plugin-websocket';
import { SonioxCaptions, sonioxConfig, type SonioxResult } from '../../shared/sonioxCaptions';
import { AudioEncoder, OpenAICaptions, sessionConfig } from '../../shared/openaiCaptions';
import { isChineseScriptConversion } from '../../shared/chinese';
import { defaultSilence, type SilenceSettings } from '../../shared/silence';
import type { Language, Segment } from '../../shared/pipeline';
import type { SessionContext } from '../../shared/context';
import type { SessionBillingOptions } from '../../shared/minutePacks';
import type { CaptionConnection, RelayEvent } from './realtime';
import type { ProviderId } from './providers';

export interface ProviderSocket {
  addListener(callback:(message:Message)=>void):()=>void;
  send(data:string|number[]):Promise<void>;
  disconnect():Promise<void>;
}
export type SocketFactory = (url:string,config?:{headers?:Record<string,string>})=>Promise<ProviderSocket>;

/** Desktop-only BYOK. The socket connects to the provider, never Audeeo's relay. */
export class DirectCaptionClient implements CaptionConnection {
  private socket?:ProviderSocket;
  private unlisten?:()=>void;
  private ended=false;
  private stopping=false;
  private finishReason="stopped";
  private voice=false;
  private translating=false;
  private queue=Promise.resolve();
  private buffered=0;
  private elapsed=0;
  private samples=0;
  private lastSpeech=0;
  private silence=defaultSilence;
  private encoder=new AudioEncoder();
  private captions?:SonioxCaptions|OpenAICaptions;
  private endedPromise:Promise<void>;
  private resolveEnded!:()=>void;
  private rejectConnect?:(error:Error)=>void;
  private readyTimer?:ReturnType<typeof setTimeout>;
  private idleTimer?:ReturnType<typeof setInterval>;
  constructor(private provider:ProviderId,private key:string,private emit:(event:RelayEvent)=>void,
    private connectSocket:SocketFactory=(url,config)=>NativeSocket.connect(url,{...config,writeBufferSize:0,maxWriteBufferSize:256000,maxMessageSize:2*1024*1024})) {
    this.endedPromise=new Promise(resolve=>{this.resolveEnded=resolve;});
  }
  async connect(_token:string,source:Language,target:Language,silence:SilenceSettings=defaultSilence,billing?:SessionBillingOptions,context?:SessionContext) {
    this.silence=silence;this.voice=!!billing?.voiceEnabled;
    this.translating=source!==target&&!isChineseScriptConversion(source,target);
    if(this.provider==='soniox')this.voice=false;
    const id=crypto.randomUUID();
    const publish=(segment:Segment)=>this.emit({type:'segment',segment});
    this.captions=this.provider==='soniox'?new SonioxCaptions(id,source,target,publish):new OpenAICaptions(id,source,target,publish);
    const endpoint=this.provider==='soniox'?'wss://stt-rt.soniox.com/transcribe-websocket':this.translating
      ?'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate':'wss://api.openai.com/v1/realtime?intent=transcription';
    await new Promise<void>((resolve,reject)=>{
      this.rejectConnect=reject;
      this.readyTimer=setTimeout(()=>this.fail('The provider did not connect. Check your key, credits, and network.'),20000);
      const ready=()=>{
        if(this.ended||this.stopping)return;
        clearTimeout(this.readyTimer);this.rejectConnect=undefined;
        this.lastSpeech=Date.now();
        this.idleTimer=setInterval(()=>{
          if(!this.stopping&&Date.now()-this.lastSpeech>=this.silence.timeoutSeconds*1000)void this.finish('silence timeout');
        },1000);
        this.emit({type:'ready',sessionId:id});resolve();
      };
      void this.connectSocket(endpoint,this.provider==='openai'?{headers:{Authorization:`Bearer ${this.key}`}}:undefined).then(async socket=>{
        if(this.ended||this.stopping){await socket.disconnect();return;}
        this.socket=socket;
        this.unlisten=socket.addListener(message=>{
          if(this.ended)return;
          if(message.type==='Close'){
            if(!this.stopping)this.fail('Provider connection closed. Start again to reconnect.');
            else this.end(this.finishReason);
            return;
          }
          if(message.type!=='Text')return;
          try {
            const event=JSON.parse(message.data);
            if(event.error_code||event.type==='error'){this.fail('Provider request failed. Check your key, balance, and selected languages.');return;}
            if(this.provider==='soniox'){
              if(Array.isArray(event.tokens)){
                (this.captions as SonioxCaptions).ingest(event as SonioxResult,this.elapsed);
                if(event.tokens.some((token:{text:string})=>token.text==='<end>'||token.text==='<fin>'))this.captions?.flush();
              }
              if(event.finished)this.end(this.finishReason);
            }else{
              if(event.type==='session.updated'&&this.rejectConnect)ready();
              (this.captions as OpenAICaptions).ingest(event,this.elapsed);
              if(event.type==='session.output_audio.delta'&&typeof event.delta==='string'&&this.voice)this.emit({type:'audio',pcm:event.delta,sampleRate:24000});
              if(event.type==='session.closed'||(this.stopping&&!this.translating&&event.type==='conversation.item.input_audio_transcription.completed'))this.end(this.finishReason);
            }
          }catch{this.fail('The provider returned an invalid response. Restart the session.');}
        });
        await socket.send(JSON.stringify(this.provider==='soniox'?{api_key:this.key,...sonioxConfig(source,target,'stt-rt-v5',context)}:sessionConfig(source,target)));
        if(this.provider==='soniox')ready();
      }).catch(()=>this.fail('Could not connect to the provider. Check your API key and network.'));
    });
    this.key='';
  }
  control(message:{type:'voice';enabled:boolean}|{type:'use_packs'}) {
    if(message.type!=='voice')return;
    this.voice=this.provider==='openai'&&this.translating&&message.enabled;
    // BYOK has no Audeeo allowance or metering; this acknowledges a playback change only.
    this.emit({type:'billing',voiceEnabled:this.voice,rate:1,paused:false,allowPurchasedMinutes:false});
    if(!this.voice)this.emit({type:'audio_reset'});
  }
  sendAudio(pcm:Int16Array) {
    if(this.stopping||this.ended||!this.socket)return;
    let square=0;for(const sample of pcm)square+=(sample/32768)**2;
    if(10*Math.log10(square/Math.max(1,pcm.length))>=this.silence.thresholdDbfs)this.lastSpeech=Date.now();
    this.samples+=pcm.length;this.elapsed=this.samples/16;
    const data=this.provider==='soniox'?Array.from(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength))
      :JSON.stringify({type:this.translating?'session.input_audio_buffer.append':'input_audio_buffer.append',audio:this.encoder.encode(pcm)});
    this.buffered+=data.length;
    if(this.buffered>256000){this.fail('The network cannot keep up with audio. Capture stopped; reconnect and retry.');return;}
    this.queue=this.queue.then(async()=>{if(!this.ended)await this.socket?.send(data);}).catch(()=>this.fail('Sending audio failed. Check your connection and restart.')).finally(()=>{this.buffered-=data.length;});
  }
  private fail(message:string) {
    if(this.ended)return;
    this.rejectConnect?.(new Error(message));this.rejectConnect=undefined;
    this.emit({type:'error',message});this.end(message);
  }
  private end(reason:string) {
    if(this.ended)return;
    this.ended=true;this.key='';
    clearTimeout(this.readyTimer);clearInterval(this.idleTimer);
    this.captions?.flush();this.unlisten?.();this.unlisten=undefined;
    void this.socket?.disconnect().catch(()=>{});
    this.resolveEnded();this.emit({type:'finished',reason});
  }
  async finish(reason='stopped') {
    if(this.ended)return;
    if(this.stopping)return this.endedPromise;
    this.finishReason=reason;this.stopping=true;clearInterval(this.idleTimer);
    if(this.rejectConnect){this.rejectConnect(new Error('Connection cancelled.'));this.rejectConnect=undefined;this.end(reason);return;}
    if(!this.socket){this.end(reason);return;}
    await this.queue;
    if(this.ended)return;
    try {
      if(this.provider==='soniox')await this.socket.send('');
      else if(this.translating)await this.socket.send(JSON.stringify({type:'session.close'}));
      else if(this.samples>=1600)await this.socket.send(JSON.stringify({type:'input_audio_buffer.commit'}));
      else {this.end(reason);return;}
      let timer:ReturnType<typeof setTimeout>|undefined;
      await Promise.race([this.endedPromise,new Promise<void>(resolve=>{timer=setTimeout(()=>{
        this.emit({type:'error',message:'Provider finalization timed out. The last captions may be incomplete.'});this.end(reason);resolve();
      },10000);})]);clearTimeout(timer);
    }catch{this.fail('Could not finish the provider session. The last captions may be incomplete.');}
  }
}
