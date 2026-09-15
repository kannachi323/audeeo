// Controlled context comparison. Reads the Soniox key but never logs or saves it.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {SonioxBackend} from '../services/session-relay/src/soniox.ts';

const env = {...parseEnv(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env};
if (!env.SONIOX_API_KEY) throw new Error('Set SONIOX_API_KEY in .env.');
const fixtures = process.argv.slice(2).map((path,index)=>({
  path,
  category:index === 0 ? 'religious-spiritual' : 'philosophy',
  terms:index === 0 ? ['theosis','perichoresis','patristic'] : ['eudaimonia','Husserl','epoché'],
  translationTerms:index === 0 ? [{source:'theosis',target:'神化'},{source:'perichoresis',target:'相互内住'}] : [{source:'eudaimonia',target:'幸福生活'},{source:'epoché',target:'悬置'}],
}));
if (fixtures.length !== 2) throw new Error('Usage: benchmark-soniox-context <religious.pcm> <philosophy.pcm>');
async function run(fixture,enabled) {
  const audio=fs.readFileSync(fixture.path);
  if (!audio.length || audio.length%2 || audio.length>32000*30) throw new Error('Fixtures must be PCM16 mono 16kHz and at most 30 seconds.');
  let source='',translation='',resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;}); void done.catch(()=>{});
  const context=enabled?{category:fixture.category,text:'A controlled terminology accuracy fixture.',terms:fixture.terms,translationTerms:fixture.translationTerms}:undefined;
  const backend=new SonioxBackend(env.SONIOX_API_KEY,'context-benchmark','en','zh',segment=>{
    if(segment.final){source+=segment.sourceText;translation+=segment.translatedText;}
  },()=>rejectDone(new Error('Soniox benchmark session failed.')),resolveDone,env.SONIOX_MODEL,context);
  const timer=setTimeout(()=>{backend.close();rejectDone(new Error('Soniox benchmark timed out.'));},60000);
  try {
    await backend.connect();
    for(let i=0;i<audio.length;i+=3200){backend.sendAudio(audio.subarray(i,i+3200));await new Promise(resolve=>setTimeout(resolve,100));}
    await Promise.all([backend.finish(),done]); backend.captions.flush();
    const normalized=source.toLocaleLowerCase('en');
    return {source,translation,sourceTermHits:fixture.terms.filter(term=>normalized.includes(term.toLocaleLowerCase('en'))).length,translationTermHits:fixture.translationTerms.filter(term=>translation.includes(term.target)).length};
  } finally {clearTimeout(timer);backend.close();}
}
const reports=[];
for(const fixture of fixtures){
  const without=await run(fixture,false),withContext=await run(fixture,true);
  reports.push({category:fixture.category,expectedSourceTerms:fixture.terms,expectedTranslations:fixture.translationTerms.map(item=>item.target),withoutContext:without,withContext,sourceHitDelta:withContext.sourceTermHits-without.sourceTermHits,translationHitDelta:withContext.translationTermHits-without.translationTermHits});
}
const report={date:new Date().toISOString(),model:env.SONIOX_MODEL||'stt-rt-v5',reports};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/soniox-context-benchmark.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
