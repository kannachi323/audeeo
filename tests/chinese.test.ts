import { expect, it } from 'vitest';
import { SonioxCaptions, sonioxConfig } from '../services/session-relay/src/soniox';
import { OpenAICaptions, sessionConfig } from '../services/session-relay/src/openai';
import type { Segment } from '../shared/pipeline';

it('converts provisional and final Soniox captions across token boundaries', () => {
  const events: Segment[] = [];
  const captions = new SonioxCaptions('test','en','zh',s=>events.push(s));
  const ingest = (tokens: any[]) => captions.ingest({tokens,total_audio_proc_ms:500,final_audio_proc_ms:500},500);
  ingest([{text:'His hair grows.',is_final:true},{text:'头',is_final:true,translation_status:'translation'}]);
  ingest([{text:'发长',is_final:false,translation_status:'translation'}]);
  expect(events.at(-1)?.translatedText).toBe('頭髮長');
  ingest([{text:'发长了。',is_final:true,translation_status:'translation'}]);
  captions.flush();
  expect(events.at(-1)).toMatchObject({sourceText:'His hair grows.',translatedText:'頭髮長了。',final:true});
});

it('uses Traditional Chinese for Chinese source captions and keeps Japanese unchanged', () => {
  for (const [language,text,expected] of [['zh','学习汉语，发展经济。','學習漢語，發展經濟。'],['ja','図書館で勉強します。','図書館で勉強します。']]) {
    const events: Segment[]=[];
    const captions=new SonioxCaptions('test',language,'en',s=>events.push(s));
    captions.ingest({tokens:[{text,is_final:true}],total_audio_proc_ms:500,final_audio_proc_ms:500},500);
    captions.flush();
    expect(events.at(-1)?.sourceText).toBe(expected);
  }
});

it('also converts OpenAI live output and finalized history snapshots', () => {
  const events: Segment[]=[];
  const captions=new OpenAICaptions('test','en','zh',s=>events.push(s));
  captions.ingest({type:'session.output_transcript.delta',delta:'这是中文翻译'},500);
  expect(events.at(-1)?.translatedText).toBe('這是中文翻譯');
  captions.flush();
  expect(events.at(-1)).toMatchObject({translatedText:'這是中文翻譯',final:true});
});

it('requests the supported Chinese language and formats Simplified output for either provider',()=>{
  expect(sonioxConfig('en','zh-cn').translation).toEqual({type:'one_way',target_language:'zh'});
  expect(sessionConfig('en','zh-cn').session.audio.output?.language).toBe('zh');
  const soniox: Segment[]=[], openai: Segment[]=[];
  const a=new SonioxCaptions('test','en','zh-cn',s=>soniox.push(s));
  a.ingest({tokens:[{text:'這是中文翻譯。',is_final:true,translation_status:'translation'}],total_audio_proc_ms:500,final_audio_proc_ms:500},500);
  a.flush();
  const b=new OpenAICaptions('test','en','zh-cn',s=>openai.push(s));
  b.ingest({type:'session.output_transcript.delta',delta:'這是中文翻譯。'},500);
  b.flush();
  for(const events of [soniox,openai]) expect(events.at(-1)).toMatchObject({translatedText:'这是中文翻译。',targetLanguage:'zh-cn',final:true});
});

it.each([['zh','zh-cn','學習漢語。','学习汉语。'],['zh-cn','zh','学习汉语。','學習漢語。']])(
  'supports Chinese script changes from %s to %s through transcription', (source,target,sourceText,translatedText)=>{
    expect(sonioxConfig(source,target)).not.toHaveProperty('translation');
    expect(sessionConfig(source,target).session.type).toBe('transcription');
    const soniox: Segment[]=[], openai: Segment[]=[];
    const a=new SonioxCaptions('test',source,target,s=>soniox.push(s));
    a.ingest({tokens:[{text:'学习汉语。',is_final:true}],total_audio_proc_ms:500,final_audio_proc_ms:500},500);
    a.flush();
    const b=new OpenAICaptions('test',source,target,s=>openai.push(s));
    b.ingest({type:'conversation.item.input_audio_transcription.completed',item_id:'1',transcript:'學習漢語。'},500);
    for(const events of [soniox,openai]) expect(events.at(-1)).toMatchObject({sourceText,translatedText,final:true});
  },
);
