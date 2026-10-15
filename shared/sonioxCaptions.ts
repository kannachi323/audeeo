import { SonioxCaptions as CoreSonioxCaptions, sonioxConfig as coreSonioxConfig } from '../packages/core/src';
import type { Language, Segment } from './pipeline';
import { hasSessionContext, sonioxContext, type SessionContext } from './context';
import { formatChineseSegment, isChineseScriptConversion } from './chinese';
export type { SonioxResult } from '../packages/core/src';

export function sonioxConfig(source: Language, target: Language, model = 'stt-rt-v5', context?: SessionContext) {
  // Mandarin script conversion happens locally, never as provider translation.
  const translateTo = isChineseScriptConversion(source, target) ? source : target;
  return coreSonioxConfig(source, translateTo, {model, context: context && hasSessionContext(context) ? sonioxContext(context) : undefined});
}

/** Audeeo's captions: the shared Soniox adapter plus Chinese script formatting. */
export class SonioxCaptions extends CoreSonioxCaptions<Language> {
  constructor(sessionId: string, source: Language, target: Language, emit: (s: Segment) => void) {
    super(sessionId, source, target, emit, {format: formatChineseSegment});
  }
}
