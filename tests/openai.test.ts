import { it, expect } from 'vitest';
import { AudioEncoder, OpenAICaptions, sessionConfig } from '../services/session-relay/src/openai';
it('selects exactly one model according to caption mode', () => {
 expect(JSON.stringify(sessionConfig('en','en'))).toContain('gpt-live-transcribe');
 expect(sessionConfig('en','en').session.audio.input?.turn_detection).toBeNull();
 expect(sessionConfig('en','zh')).toEqual({type:'session.update',session:{audio:{output:{language:'zh'}}}});
});
it('preserves final transcription corrections under one caption ID', () => {
 const rows:any[]=[];const c=new OpenAICaptions('s','en','en',s=>rows.push(s));
 c.ingest({type:'conversation.item.input_audio_transcription.delta',item_id:'a',delta:'fifteen'},10);
 c.ingest({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'fifty'},20);
 expect(rows[1]).toMatchObject({id:rows[0].id,sourceText:'fifty',translatedText:'',final:true,state:'complete'});
});
it('streams translated fragments without fabricated source text or spaces', () => {
 const rows:any[]=[];const c=new OpenAICaptions('s','en','zh',s=>rows.push(s));
 c.ingest({type:'session.output_transcript.delta',delta:'你'},10);
 c.ingest({type:'session.output_transcript.delta',delta:'好。'},20);
 expect(rows.at(-1)).toMatchObject({translatedText:'你好。',sourceText:'',final:true});
});
it('resamples continuously independent of packet boundaries', () => {
 const pcm=new Int16Array([0,100,200,300,400,500]);
 const a=new AudioEncoder(),b=new AudioEncoder();
 expect(atob(a.encode(pcm.buffer))).toBe(atob(b.encode(pcm.buffer.slice(0,6)))+atob(b.encode(pcm.buffer.slice(6))));
});
it('accepts WebSocket typed-array payloads without including surrounding bytes', () => {
 const packet = new Uint8Array([99,99,0,0,100,0,200,0,99,99]);
 const expected = new AudioEncoder().encode(packet.buffer.slice(2,8));
 expect(new AudioEncoder().encode(packet.subarray(2,8))).toBe(expected);
 expect(new AudioEncoder().encode(new DataView(packet.buffer,2,6))).toBe(expected);
});
