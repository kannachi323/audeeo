// Uses only the supplied test fixture. Never logs credentials or provider error payloads.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {SonioxBackend} from '../services/session-relay/src/soniox.ts';

const env = {...parseEnv(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env};
if (!env.SONIOX_API_KEY) throw new Error('Set SONIOX_API_KEY in .env.');
if (!process.argv[2]) throw new Error('Usage: npm run test:soniox -- <16kHz-mono-PCM16-file>');
const audio = fs.readFileSync(process.argv[2]);
if (!audio.length || audio.length % 2 || audio.length > 32000 * 30) throw new Error('Use a nonempty PCM16 fixture of at most 30 seconds.');
const reports = [];
for (const target of ['en', 'zh']) {
  const report = {mode:target === 'en' ? 'transcription' : 'translation', audioSeconds:audio.length / 32000, firstCaptionMs:null, captions:0, finalSourceCharacters:0, finalTranslationCharacters:0, finished:false};
  const start = Date.now();
  let resolveDone, rejectDone, failure;
  const done = new Promise((resolve, reject) => {resolveDone=resolve; rejectDone=reject;});
  // Observe rejection while audio is still being paced.
  void done.catch(() => {});
  const backend = new SonioxBackend(env.SONIOX_API_KEY, 'synthetic-test', 'en', target, segment => {
    report.captions++;
    if (segment.sourceText || segment.translatedText) report.firstCaptionMs ??= Date.now() - start;
    if (segment.final) {
      report.finalSourceCharacters += segment.sourceText.length;
      report.finalTranslationCharacters += segment.translatedText.length;
    }
  }, message => {failure = new Error(message); rejectDone(failure);}, () => {report.finished=true; resolveDone();}, env.SONIOX_MODEL);
  const timer = setTimeout(() => {failure = new Error('Soniox live test timed out.'); rejectDone(failure); backend.close();}, 60000);
  try {
    await backend.connect();
    for (let i=0; i<audio.length; i+=3200) {
      if (failure) throw failure;
      backend.sendAudio(audio.subarray(i, i+3200));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    report.stopAtMs = Date.now() - start;
    await Promise.all([backend.finish(), done]);
    backend.captions.flush();
    if (!report.finished || !report.finalSourceCharacters || report.firstCaptionMs >= report.stopAtMs || (target !== 'en' && !report.finalTranslationCharacters)) throw new Error('Soniox live test did not produce streaming, finalized captions.');
    reports.push(report);
    console.log(JSON.stringify(report));
  } finally {clearTimeout(timer); backend.close();}
}
fs.mkdirSync('artifacts', {recursive:true});
fs.writeFileSync('artifacts/soniox-streaming-verification.json', JSON.stringify({date:new Date().toISOString(),model:env.SONIOX_MODEL || 'stt-rt-v5',reports},null,2));
