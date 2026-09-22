// Sends only a short, synthetic sentence. Never logs credentials or returned audio.
if(!process.env.SONIOX_API_KEY)throw Error('SONIOX_API_KEY is required');
const ws=new WebSocket('wss://tts-rt.soniox.com/tts-websocket');
const stream=crypto.randomUUID();let bytes=0;
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{ws.close();reject(Error('TTS smoke test timed out'));},20000);
 ws.addEventListener('open',()=>{ws.send(JSON.stringify({api_key:process.env.SONIOX_API_KEY,model:'tts-rt-v2',voice:'Daniel',language:'en',audio_format:'pcm_s16le',sample_rate:24000,stream_id:stream}));ws.send(JSON.stringify({stream_id:stream,text:'Your captions are ready.',text_end:true}));});
 ws.addEventListener('message',event=>{const e=JSON.parse(event.data);if(e.error_code){clearTimeout(timer);ws.close();reject(Error(`TTS rejected request (${e.error_code}, ${e.error_type})`));return;}if(e.audio)bytes+=Buffer.from(e.audio,'base64').length;if(e.terminated){clearTimeout(timer);ws.close();bytes?resolve():reject(Error('No speech returned'));}});
 ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('TTS connection failed'));});
});
console.log(JSON.stringify({model:'tts-rt-v2',voice:'Daniel',sampleRate:24000,pcmBytes:bytes,ok:bytes>0}));
