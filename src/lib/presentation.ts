export type SessionPhase = 'idle' | 'connecting' | 'live' | 'stopping';
export type Page = 'captions' | 'history' | 'settings' | 'account' | 'configuration' | 'overlay' | 'providers';
export type Presentation = { phase: SessionPhase; page: Page; playing: boolean };
export type PresentationAction = { type: 'phase'; value: SessionPhase } | { type: 'page'; value: Page } | { type: 'playing'; value: boolean };
export const initialPresentation: Presentation = { phase: 'idle', page: 'captions', playing: false };
export function presentationReducer(state: Presentation, action: PresentationAction): Presentation {
  if (action.type === 'phase') return { ...state, phase: action.value };
  if (action.type === 'page') return { ...state, page: action.value };
  return { ...state, playing: action.value };
}
export function isOverlay(state: Presentation) {
  return state.phase === 'live' || state.phase === 'stopping' || state.playing;
}
/** Streaming resampling keeps packet boundaries from changing the audio duration. */
export class SourceResampler {
  private samples: number[] = [];
  private position = 0;
  convert(input: Int16Array) {
    this.samples.push(...input);
    const out: number[] = [];
    while (this.position + 1 < this.samples.length) {
      const index = Math.floor(this.position), fraction = this.position - index;
      out.push(Math.round(this.samples[index] * (1-fraction) + this.samples[index+1] * fraction));
      this.position += 1.5;
    }
    const consumed = Math.floor(this.position);
    this.samples = this.samples.slice(consumed); this.position -= consumed;
    return new Int16Array(out);
  }
}
