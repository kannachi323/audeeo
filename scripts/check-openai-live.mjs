// Synthetic fixture only. Provider key stays in this process; report contains no credentials.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
const WS=createRequire(new URL('../services/session-relay/package.json',import.meta.url))('ws');
const env=parseEnv(fs.readFileSync(new URL('../.env',import.meta.url),'utf8'));
const audio=fs.readFileSync(process.argv[2]);
const results=[];
for(const mode of ['server_vad','semantic_vad','transcribe','translate']) {
 await new Promise((resolve,reject)=>{
 const translate=mode==='translate', vad=mode.endsWith('vad')?{type:mode}:null;
 const ws=new WS(translate?'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate':'wss://api.openai.com/v1/realtime?intent=transcription',{headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`}});
 const report={mode,seconds:audio.length/48000,deltaCount:0,audioBytes:0,firstDeltaMs:null,lastDeltaMs:null,commits:0};
 let begun=false,started=0;
 const timer=setTimeout(()=>{ws.terminate();reject(new Error(`${mode} timed out`))},90000);
 const done=()=>{clearTimeout(timer);ws.close();results.push(report);console.log(JSON.stringify(report));resolve()};
 ws.on('error',e=>{clearTimeout(timer);reject(e)});
 ws.on('open',()=>ws.send(JSON.stringify({type:'session.update',session:translate?{audio:{output:{language:'zh'}}}:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-live-transcribe',languages:['en'],delay:'low'},turn_detection:vad}}}})));
 ws.on('message',async b=>{const e=JSON.parse(b);
 if(e.type==='error'){report.error=e.error;done();return}
 if(e.type==='session.updated'&&!begun){begun=true;report.accepted=true;if(vad){done();return}started=Date.now();const pcm=Buffer.concat([audio,Buffer.alloc(48000)]);for(let i=0;i<pcm.length&&ws.readyState===WS.OPEN;i+=4800){ws.send(JSON.stringify({type:translate?'session.input_audio_buffer.append':'input_audio_buffer.append',audio:pcm.subarray(i,i+4800).toString('base64')}));await new Promise(r=>setTimeout(r,100))}if(ws.readyState===WS.OPEN){report.commitAtMs=Date.now()-started;report.commits=translate?0:1;ws.send(JSON.stringify({type:translate?'session.close':'input_audio_buffer.commit'}))}}
 if(e.type==='session.output_audio.delta'){report.audioBytes+=Buffer.from(e.delta,'base64').length;report.audioFormat={sampleRate:e.sample_rate,channels:e.channels,format:e.format,chunkBytes:Buffer.from(e.delta,'base64').length};}
 if(e.type==='session.output_transcript.delta'||e.type==='conversation.item.input_audio_transcription.delta'){report.deltaCount++;report.firstDeltaMs??=Date.now()-started;report.lastDeltaMs=Date.now()-started}
 if(e.type==='session.closed'||e.type==='conversation.item.input_audio_transcription.completed'){report.finalEvent=e.type;done()}
 });
 });
}
fs.writeFileSync('artifacts/openai-streaming-verification.json',JSON.stringify({date:new Date().toISOString(),fixture:'macOS synthesized English speech; 24kHz mono PCM16',results},null,2));

for (const report of results.filter(r=>r.mode==='transcribe'||r.mode==='translate')) {
  if (!report.accepted || !report.finalEvent || report.deltaCount===0 || report.firstDeltaMs>=report.commitAtMs || report.lastDeltaMs < report.seconds*1000-5000 || (report.mode==='translate'&&!report.audioBytes))
    throw new Error(`Streaming verification failed: ${report.mode}; inspect the saved report`);
}
