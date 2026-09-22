import {identity,db,refreshEntitlement,isDevelopmentUser,billingSandbox,type Env} from './backend';
import {validLanguagePair} from '../../../shared/languages';
import {sessionContext,type SessionContext} from '../../../shared/context';
import type {Language,Segment} from '../../../shared/pipeline';
import {spokenTranslationSupported} from '../../../shared/minutePacks';
import {SonioxBackend} from './soniox';
import {SonioxVoice} from './sonioxVoice';
import {UsageMeter} from './meter';
import {SilenceGuard} from './silence';
export function liveSession(env:Env):Response {
 const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.binaryType='arraybuffer';socket.accept();
 const sessionId=crypto.randomUUID(),sessionStartedAt=new Date().toISOString();
 let meter:UsageMeter|undefined,backend:SonioxBackend|undefined,voice:SonioxVoice|undefined;
 let source:Language,target:Language,context:SessionContext,historyGeneration=1;
 let started=false,closed=false,closing=false,finishing=false,adjusting=false,awaitingAudio=false,paused=false,voiceEnabled=false,part=0,epoch=0;
 let silence:SilenceGuard|undefined,silenceConfig:unknown;let audioBytes=0,connectionStarted=0;
 let drain:ReturnType<typeof setTimeout>|undefined;
 let expiry:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setInterval>|undefined;
 let chain=Promise.resolve();
 const send=(e:unknown)=>{if(!closed)try{socket.send(JSON.stringify(e));}catch{}};
 const serial=(fn:()=>Promise<void>)=>{chain=chain.then(fn).catch(async()=>{send({type:'error',message:'Session service unavailable. Retry.'});await stop('error');});};
 const state=(message?:string)=>send({type:'billing',voiceEnabled,rate:voiceEnabled?3:1,paused,allowPurchasedMinutes:meter?.allowPacks??false,...(message?{message}:{})});
 const stop=async(reason:string)=>{
  if(closed||closing)return;closing=true;epoch++;clearTimeout(auth);clearTimeout(expiry);clearTimeout(drain);clearInterval(timer);
  voice?.cancel();voice=undefined;voiceEnabled=false;backend?.captions.flush();closed=true;backend?.close();
  await meter?.stop().catch(()=>{});
  try{socket.send(JSON.stringify({type:'finished',reason}));socket.close(1000,'Session ended');}catch{}
 };
 const pause=async()=>{
  if(paused||closed)return;paused=true;epoch++;voice?.cancel();backend?.captions.flush();backend?.close();backend=undefined;
  send({type:'audio_reset'});state();await meter?.stop();send({type:'pack_consent_required'});
 };
 const failVoice=()=>serial(async()=>{
  if(closed||closing||finishing)return;
  adjusting=true;voiceEnabled=false;voice?.cancel();voice=undefined;send({type:'audio_reset'});
  if(!paused && !await meter!.change(1))await pause();
  state('Spoken translation failed. Captions remain available; retry the voice toggle.');adjusting=false;
 });
 const configureVoice=()=>{
  voice?.cancel();voice=voiceEnabled?new SonioxVoice(env.SONIOX_API_KEY!,target,pcm=>{if(voiceEnabled&&!paused&&meter?.available)send({type:'audio',pcm,sampleRate:24000});},failVoice):undefined;
 };
 const connect=async()=>{
  const run=++epoch;part++;const connectionPart=part;
  backend=new SonioxBackend(env.SONIOX_API_KEY!,sessionId,source,target,(segment:Segment)=>{
   const adjusted={...segment,id:`${sessionId}:${connectionPart}:${segment.id}`,sequence:connectionPart*1_000_000+segment.sequence,historyGeneration,sessionStartedAt};
   send({type:'segment',segment:adjusted});
   if(segment.final && voiceEnabled&&!paused)voice?.speak(segment.translatedText);
  },()=>{if(run===epoch){send({type:'error',message:'Soniox session failed. Please retry.'});serial(()=>stop('provider error'));}},()=>{if(run===epoch)serial(()=>stop('finished'));},env.SONIOX_MODEL||'stt-rt-v5',context);
  await backend.connect();if(closed){backend.close();await meter?.stop();return;}awaitingAudio=true;connectionStarted=Date.now();audioBytes=0;silence=new SilenceGuard(connectionStarted,silenceConfig);
 };
 const auth=setTimeout(()=>void stop('authentication timeout'),10000);
 socket.addEventListener('message',event=>{
  if(closed||closing)return;
  if(typeof event.data==='string'){
   if(event.data.length>20000){void stop('invalid request');return;}
   serial(async()=>{
    const c=JSON.parse(event.data as string);
    if(!started){
     if(c.type!=='start'||!validLanguagePair(c.sourceLanguage,c.targetLanguage)||c.providerKey)throw new Error('Invalid session');
     started=true;clearTimeout(auth);const user=await identity(env,c.accessToken);
     const sandbox=billingSandbox(env,user.id,c.sandbox===true);
     if(!env.SONIOX_API_KEY)throw new Error('Soniox is not configured');
     source=c.sourceLanguage;target=c.targetLanguage;context=sessionContext(c.context??{category:'general',text:'',terms:[],translationTerms:[]});silenceConfig=c.silence;
     const rows=await db(env,`session_history_settings?owner_id=eq.${user.id}&select=generation`,undefined,'GET');historyGeneration=Number(rows?.[0]?.generation??1);
     const dev=!sandbox && isDevelopmentUser(env,user.id);if(!dev)await refreshEntitlement(env,user.id,sandbox);if(closed)return;
     meter=new UsageMeter(env,user.id,sessionId,dev,Date.now,sandbox?'SANDBOX':'PRODUCTION');
     voiceEnabled=c.voiceEnabled===true && spokenTranslationSupported(source,target);
     if(!await meter.change(voiceEnabled?3:1,c.allowPurchasedMinutes===true,true)){paused=true;state();send({type:'ready',sessionId});send({type:'pack_consent_required'});}
     else{if(closed){await meter.stop();return;}configureVoice();await connect();state();send({type:'ready',sessionId});}
     if(closed)return;
     expiry=setTimeout(()=>void stop('limit'),Math.min(Math.min(14400,Math.max(15,Number(env.MAX_SESSION_SECONDS)||1800))*1000,user.expiresAt-Date.now()));
     timer=setInterval(()=>{
      if(!closed&&!paused&&!finishing&&!adjusting&&!awaitingAudio&&meter&&!meter.available){void pause().catch(()=>stop('billing failure'));return;}
      serial(async()=>{
      if(closed||paused||finishing)return;
      if(silence?.expired(Date.now())){await stop('silence timeout');return;}
      if(!awaitingAudio&&!await meter!.tick())await pause();
     });},250);
     return;
    }
    if(c.type==='stop'){
     if(finishing)return;finishing=true;clearInterval(timer);voice?.cancel();voice=undefined;voiceEnabled=false;send({type:'audio_reset'});await meter?.stop();
     if(!backend){await stop('stopped');return;}
     drain=setTimeout(()=>serial(()=>stop('stop timeout')),15000);
     void backend.finish().catch(()=>serial(()=>stop('provider error')));return;
    }
    if(finishing)return;
    if(c.type==='voice'){
     const next=c.enabled===true && spokenTranslationSupported(source,target);
     if(next===voiceEnabled){state();return;}
     voice?.cancel();voice=undefined;send({type:'audio_reset'});adjusting=true;
     if(!paused&&!await meter!.change(next?3:1,undefined,awaitingAudio))await pause();
     voiceEnabled=next;configureVoice();state();adjusting=false;return;
    }
    if(c.type==='use_packs' && paused){
     adjusting=true;
     if(!await meter!.change(voiceEnabled?3:1,true,true)){state('No purchased minutes available. Buy a pack or refresh purchases.');adjusting=false;return;}
     paused=false;configureVoice();await connect();state();adjusting=false;return;
    }
    throw new Error('Unsupported control');
   });
  }else{
   if(!backend||paused||closed||finishing||adjusting)return;
   const pcm=event.data;if(!(pcm instanceof ArrayBuffer)&&!ArrayBuffer.isView(pcm)){void stop('invalid audio');return;}
   const size=pcm.byteLength;
   if(size>32768||size%2||audioBytes+size>((Date.now()-connectionStarted)/1000+2)*32000){void stop('audio rate exceeded');return;}
   if(!size)return;
   if(awaitingAudio){meter?.activate();awaitingAudio=false;connectionStarted=Date.now();}
   if(!meter?.available){void pause().catch(()=>stop('billing failure'));return;}
   audioBytes+=size;silence?.observe(pcm,Date.now());backend.sendAudio(pcm);
  }
 });
 socket.addEventListener('close',()=>serial(()=>stop('client disconnected')));
 socket.addEventListener('error',()=>serial(()=>stop('connection lost')));
 return new Response(null,{status:101,webSocket:client});
}
