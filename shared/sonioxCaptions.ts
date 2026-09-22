export type SonioxResult = {tokens: Array<{text: string; is_final: boolean; translation_status?: string; start_ms?: number; end_ms?: number}>};
import type { Language, Segment } from './pipeline';
import { hasSessionContext, sonioxContext, type SessionContext } from './context';
import { formatChineseSegment, isChineseScriptConversion } from './chinese';

const aliases: Record<string, string> = {cmn: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hk': 'zh', nb: 'no', nn: 'no', fil: 'tl'};
export function sonioxConfig(source: Language, target: Language, model = 'stt-rt-v5', context?: SessionContext) {
  return {
    model, audio_format: 'pcm_s16le' as const, sample_rate: 16000, num_channels: 1,
    enable_language_identification: true, enable_endpoint_detection: true,
    ...(source === 'auto' ? {} : {language_hints: [aliases[source] || source]}),
    ...(source === target || isChineseScriptConversion(source,target) ? {} : {translation: {type: 'one_way' as const, target_language: aliases[target] || target}}),
    ...(context && hasSessionContext(context) ? {context: sonioxContext(context)} : {}),
  };
}

/** Final tokens are append-only; provisional tokens are a replacement snapshot.
 * Source and translation arrive independently, so never finalize on source punctuation.
 */
export class SonioxCaptions {
  private sequence = 0;
  private segment?: Segment;
  private sourceFinal = '';
  private translationFinal = '';
  private sourceDraft = '';
  private translationDraft = '';
  constructor(private sessionId: string, private source: Language, private target: Language, private emit: (s: Segment) => void) {}
  ingest(result: SonioxResult, time: number) {
    this.sourceDraft = ''; this.translationDraft = '';
    for (const token of result.tokens) {
      if (!token.text || /^<(end|fin)>$/.test(token.text)) continue;
      this.segment ??= {
        id: `${this.sessionId}:soniox-${this.sequence}`, sessionId: this.sessionId,
        sequence: this.sequence++, revision: 0, startMs: token.start_ms ?? time, endMs: token.end_ms ?? time,
        sourceLanguage: this.source, targetLanguage: this.target, sourceText: '', translatedText: '',
        final: false, state: 'provisional',
      };
      this.segment.endMs = Math.max(this.segment.endMs, token.end_ms ?? time);
      if (token.translation_status === 'translation') {
        if (token.is_final) this.translationFinal += token.text; else this.translationDraft += token.text;
      } else {
        if (token.is_final) this.sourceFinal += token.text; else this.sourceDraft += token.text;
      }
    }
    this.publish(false);
    // Bound active caption/history records even during uninterrupted speech.
    if (this.sourceFinal.length + this.translationFinal.length >= 1000) this.flush();
  }
  private publish(final: boolean) {
    if (!this.segment) return;
    this.segment.sourceText = this.sourceFinal + (final ? '' : this.sourceDraft);
    this.segment.translatedText = this.translationFinal + (final ? '' : this.translationDraft);
    this.segment.final = final;
    this.segment.state = final ? 'complete' : 'provisional';
    this.segment.revision++;
    this.emit(formatChineseSegment(this.segment));
  }
  flush() {
    // Replace any visible draft with provider-confirmed text; never save a guess as final.
    if (this.sourceFinal || this.translationFinal) this.publish(true);
    else {
      this.sourceDraft = ''; this.translationDraft = '';
      this.publish(false);
    }
    this.segment = undefined;
    this.sourceFinal = ''; this.translationFinal = '';
    this.sourceDraft = ''; this.translationDraft = '';
  }
}
