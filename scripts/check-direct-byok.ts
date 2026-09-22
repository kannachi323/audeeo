// Uses only a short synthetic fixture; never prints keys or provider payloads.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {DirectCaptionClient,type SocketFactory} from '../src/lib/directCaptions';
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
if(!env.SONIOX_API_KEY||!process.argv[2])throw new Error('Supply SONIOX_API_KEY and a short 16 kHz mono PCM16 fixture.');
const pcm=readFileSync(process.argv[2]);if(pcm.length>32000*10)throw new Error('Fixture must be <=10 seconds.');
const factory:SocketFactory=async url=>{
 const ws=new WebSocket(url);await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('Connection failed'));});
 return {addListener:callback=>{ws.onmessage=e=>callback({type:'Text',data:String(e.data)});ws.onclose=()=>callback({type:'Close',data:null});return ()=>{ws.onmessage=null;ws.onclose=null;};},send:async data=>ws.send(typeof data==='string'?data:new Uint8Array(data)),disconnect:async()=>ws.close()};
};
let captions=0,final=0,failed=false;
const client=new DirectCaptionClient('soniox',env.SONIOX_API_KEY,event=>{if(event.type==='segment'){captions++;if(event.segment.final)final++;}if(event.type==='error')failed=true;},factory);
try {await client.connect('','zh','en');for(let i=0;i<pcm.length;i+=3200){const chunk=pcm.subarray(i,i+3200);client.sendAudio(new Int16Array(chunk.buffer,chunk.byteOffset,chunk.byteLength/2));await new Promise(r=>setTimeout(r,100));}await client.finish();if(failed||!final)throw new Error('Direct provider test did not finalize captions.');console.log(JSON.stringify({provider:'soniox',audioSeconds:pcm.length/32000,captions,final,passed:true}));}finally{await client.finish();}
