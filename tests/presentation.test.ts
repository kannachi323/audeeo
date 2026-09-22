import {expect,it} from 'vitest';
import {captionSuffix} from '../src/components/LiveCaptions';
import {initialPresentation, presentationReducer, isOverlay, SourceResampler} from '../src/lib/presentation';
it('keeps navigation independent of live activity and playback drain, including failure',()=>{
  let state=initialPresentation;
  expect(isOverlay(state)).toBe(false);
  state=presentationReducer(state,{type:'phase',value:'connecting'});expect(isOverlay(state)).toBe(false);
  state=presentationReducer(state,{type:'phase',value:'live'});expect(isOverlay(state)).toBe(true);
  state=presentationReducer(state,{type:'page',value:'settings'});expect(isOverlay(state)).toBe(true);
  state=presentationReducer(state,{type:'playing',value:true});
  state=presentationReducer(state,{type:'phase',value:'idle'});expect(isOverlay(state)).toBe(true);
  state=presentationReducer(state,{type:'playing',value:false});expect(isOverlay(state)).toBe(false);
  expect(state.page).toBe('settings');
});
it('keeps recent CJK and unbroken text within the combined two-line budget',()=>{
  for(const text of ['你'.repeat(900)+'最后', 'a'.repeat(900)+'END', 'one two three '.repeat(900)+'latest']) {
    const output=captionSuffix(text,t=>Array.from(t).length<=40);
    expect(Array.from(output).length).toBeLessThanOrEqual(40);expect(text.endsWith(output)).toBe(true);
    const bilingual=captionSuffix(text,t=>Array.from(t).length<=20);
    expect(Array.from(bilingual).length).toBeLessThanOrEqual(20);
  }
});
it('repaginates for width and font metrics without changing the transcript',()=>{
  const text='This is an older sentence and this is the newest sentence.';
  const narrow=captionSuffix(text,t=>t.length<=40),largeFont=captionSuffix(text,t=>t.length<=20);
  expect(largeFont.length).toBeLessThan(narrow.length);expect(text.endsWith(largeFont)).toBe(true);
});
it('resamples capture across arbitrary packet boundaries',()=>{
  const samples=new Int16Array(Array.from({length:1000},(_,i)=>i));
  const a=new SourceResampler(),b=new SourceResampler();
  expect([...a.convert(samples)]).toEqual([...b.convert(samples.slice(0,17)),...b.convert(samples.slice(17,44)),...b.convert(samples.slice(44))]);
});
it('keeps layout probes small for long streaming transcripts without truncating wide views',()=>{
  const text='字'.repeat(100000)+'最新';
  let largest=0;
  expect(captionSuffix(text,candidate=>{largest=Math.max(largest,candidate.length);return candidate.length<=40;})).toBe(text.slice(-40));
  expect(largest).toBeLessThanOrEqual(128);
  expect(captionSuffix(text,candidate=>candidate.length<=2000)).toBe(text.slice(-2000));
  expect(captionSuffix('short',()=>true)).toBe('short');
});
