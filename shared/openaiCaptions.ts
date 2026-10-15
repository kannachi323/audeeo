import { OpenAICaptions as CoreOpenAICaptions, sessionConfig as coreSessionConfig } from '../packages/core/src';
import type { Language, Segment } from './pipeline';
import { formatChineseSegment, isChineseScriptConversion } from './chinese';
export { AudioEncoder } from '../packages/core/src';

const translates = (source: Language, target: Language) => source !== target && !isChineseScriptConversion(source, target);

export function sessionConfig(source: Language, target: Language) {
  return coreSessionConfig(source, target, translates(source, target));
}

/** Audeeo's captions: the shared OpenAI adapter plus Chinese script formatting. */
export class OpenAICaptions extends CoreOpenAICaptions<Language> {
  constructor(sessionId: string, source: Language, target: Language, emit: (s: Segment) => void) {
    super(sessionId, source, target, emit, {format: formatChineseSegment, translating: translates(source, target)});
  }
}
