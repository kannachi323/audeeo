/** Language hints verified with gpt-live-transcribe session.update (no audio), 2026-09-13.
 * See artifacts/language-validation.json and docs/openai-captions.md.
 */
export type Language = string;
const transcriptionCodes = 'af ar az be bg bn bs ca cmn cs cy da de el en es et fa fi fr gl gu he hi hr hu hy id is it ja ka kk kn ko lt lv mi mk ml mr ms nb ne nl no pl pt ro ru sk sl sr sv sw ta te th tl tr uk ur vi yue zh zh-cn zh-hk zh-tw'.split(' ');
const display = new Intl.DisplayNames(['en'], {type:'language'});
const labels: Record<string,string> = {auto:'Auto-detect', dz:'Dzongkha', tl:'Tagalog', fil:'Filipino', bn:'Bengali', zh:'Chinese (Traditional)', cmn:'Mandarin (cmn)', yue:'Cantonese', 'zh-cn':'Chinese (Simplified)', 'zh-tw':'Chinese (Traditional, Taiwan)', 'zh-hk':'Chinese (Traditional, Hong Kong)'};
export const languageName = (code: string) => labels[code] || display.of(code) || code;
const options = (codes: readonly string[]) => codes.map(value => ({value,label:languageName(value)})).sort((a,b)=>a.label.localeCompare(b.label, 'en'));
export const transcriptionLanguages = [{value:'auto',label:'Auto-detect'}, ...options(transcriptionCodes)];
/** Published translation matrix, verified 2026-09-13.
 * https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide
 */
export const translationTargets = options(['es','pt','fr','ja','ru','zh','zh-cn','de','ko','hi','id','vi','it','en']);
export const translationSources = [{value:'auto',label:'Auto-detect'}, ...options('ar af az be bn bs bg ca zh zh-cn hr cs da nl dz en eo et eu fa fi fil fr gl de el gu ht haw he hi hu hy id it ja jv ka kk ko ku la lv lt mk ms ml mi mn my ne no nn pl pt pa ro ru sr sn sk sl sq es sw sv tl te th tr uk uz vi cy yo'.split(' '))];
export const isTranscriptionLanguage = (value: unknown): value is Language => typeof value === 'string' && transcriptionLanguages.some(option=>option.value===value);
export const isTranslationSource = (value: unknown): value is Language => typeof value === 'string' && translationSources.some(option=>option.value===value);
export const isTranslationTarget = (value: unknown): value is Language => typeof value === 'string' && translationTargets.some(option=>option.value===value);
export const validLanguagePair = (source: unknown, target: unknown) => source === target ? isTranscriptionLanguage(source) : isTranslationSource(source) && isTranslationTarget(target);
