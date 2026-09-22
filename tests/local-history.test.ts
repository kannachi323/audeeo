import {expect,it} from 'vitest';
import {localHistory,saveLocalSegment,clearLocalHistory} from '../src/lib/localHistory';
import type {Segment} from '../shared/pipeline';
function storage(){const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)} as Storage;}
it('only saves final captions locally, updates revisions, and physically prunes expired sessions',()=>{
 const s=storage();const segment:Segment={id:'1',sessionId:'local',sequence:0,revision:0,startMs:0,endMs:100,sourceLanguage:'en',targetLanguage:'es',sourceText:'Hello',translatedText:'Hola',final:false,state:'provisional'};
 saveLocalSegment(s,segment,new Date().toISOString());expect(localHistory(s)).toEqual([]);
 segment.final=true;saveLocalSegment(s,segment,new Date().toISOString());segment.translatedText='Hola.';saveLocalSegment(s,segment,new Date().toISOString());
 expect(localHistory(s)[0].segments).toHaveLength(1);expect(localHistory(s)[0].segments[0].translated_text).toBe('Hola.');
 expect(localHistory(s,Date.now()+31*86400000)).toEqual([]);expect(localHistory(s)).toEqual([]);clearLocalHistory(s);
});
