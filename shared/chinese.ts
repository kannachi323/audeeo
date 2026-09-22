import { Converter } from 'opencc-js';
import type { Segment } from './pipeline';

let convert: ReturnType<typeof Converter> | undefined;
const traditional = (text: string) => text ? (convert ??= Converter({from:'cn',to:'tw'}))(text) : text;
let convertSimplified: ReturnType<typeof Converter> | undefined;
export const simplified = (text: string) => text ? (convertSimplified ??= Converter({from:'tw',to:'cn'}))(text) : text;
const usesTraditional = (language: string) => ['zh','cmn','yue','zh-tw','zh-hk'].includes(language);

/** Convert whole caption snapshots so phrase-dependent characters span token boundaries.
 * Preserve the provider's original accumulator and non-Chinese text (including Japanese).
 */
const formatChinese = (text: string, language: string) => language === 'zh-cn' ? simplified(text) : usesTraditional(language) ? traditional(text) : text;
const mandarinCodes = ['zh','zh-cn','zh-tw','zh-hk','cmn'];
export const isChineseScriptConversion = (source: string, target: string) => source !== target && mandarinCodes.includes(source) && mandarinCodes.includes(target);

export function formatChineseSegment(segment: Segment): Segment {
  return {
    ...segment,
    sourceText: formatChinese(segment.sourceText, segment.sourceLanguage),
    translatedText: formatChinese(isChineseScriptConversion(segment.sourceLanguage,segment.targetLanguage) ? segment.sourceText : segment.translatedText, segment.targetLanguage),
  };
}
