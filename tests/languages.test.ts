import {expect, it} from 'vitest';
import {transcriptionLanguages, translationSources, translationTargets, validLanguagePair} from '../shared/languages';
import {isChineseScriptConversion} from '../services/session-relay/src/chinese';
import {sessionConfig} from '../services/session-relay/src/openai';

it('accepts every selectable transcription hint and omits automatic language hints',()=>{
  for (const {value} of transcriptionLanguages) {
    expect(validLanguagePair(value,value)).toBe(true);
    const config=sessionConfig(value,value).session.audio.input?.transcription;
    expect(config?.model).toBe('gpt-live-transcribe');
    expect(config?.languages).toEqual(value==='auto'?undefined:[value]);
  }
});
it('supports every published translation input and output independently',()=>{
  expect(translationSources.length).toBeGreaterThan(70);
  expect(translationTargets).toHaveLength(14);
  for (const source of translationSources) for (const target of translationTargets) {
    if(source.value===target.value || isChineseScriptConversion(source.value,target.value)) continue;
    expect(validLanguagePair(source.value,target.value)).toBe(true);
    expect(sessionConfig(source.value,target.value).session.audio.output?.language).toBe(target.value === 'zh-cn' ? 'zh' : target.value);
  }
  expect(validLanguagePair('ar','fr')).toBe(true);
  expect(validLanguagePair('en','ar')).toBe(false);
  expect(validLanguagePair('zz','en')).toBe(false);
  expect(validLanguagePair(null,null)).toBe(false);
});
