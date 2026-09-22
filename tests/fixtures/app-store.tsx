// Marketing capture fixture: production UI, fictional local data, no recording or AI requests.
import {useState, type CSSProperties} from 'react';
import {createRoot} from 'react-dom/client';
import {AudioLines,History,Settings2,Square,ArrowLeft} from 'lucide-react';
import type {Session} from '@supabase/supabase-js';
import {LiveCaptions} from '../../src/components/LiveCaptions';
import {CaptionToolbar} from '../../src/components/CaptionToolbar';
import {CaptureStatus} from '../../src/components/CaptureStatus';
import {ContextSettings} from '../../src/components/ContextSettings';
import {HistoryRows} from '../../src/components/HistoryRows';
import {SessionIntelligence} from '../../src/components/SessionIntelligence';
import {Button} from '../../src/components/Button';
import type {HistorySession} from '../../src/lib/account';
import {emptySessionContext} from '../../shared/context';
import {AudioControls,type ControlGroup} from '../../src/components/AudioControls';
import {OverlaySettings} from '../../src/components/OverlaySettings';
import {defaultOverlayAppearance} from '../../src/lib/overlayAppearance';
import '../../src/styles.css';
import './app-store.css';
const noop=()=>{};
const context={...emptySessionContext,category:'education' as const,text:'A design workshop about focus, attention, and building calmer digital experiences.',terms:['cognitive load','visual hierarchy','progressive disclosure'],translationTerms:[{source:'cognitive load',target:'carga cognitiva'}]};
const sampleRows:HistorySession[]=['Designing for focus','A little Spanish, every day','Ideas for the next chapter','The science of better sleep'].map((title,i)=>({id:`showcase-${i}`,summary_title:title,started_at:`2026-09-${15-i}T17:30:00Z`,source_language:'en',target_language:'en',segments:[],session_summaries:[]}));
const summaryRow:HistorySession={...sampleRows[0],session_summaries:[{session_id:'showcase-0',language:'en',model:'sample',created_at:'2026-09-15T18:00:00Z',updated_at:'2026-09-15T18:00:00Z',content:{title:'Designing for focus',recap:'A practical workshop on making digital experiences easier to understand, with fewer distractions and clearer next steps.',keyPoints:['Reduce cognitive load by showing only what matters now.','Use a clear visual hierarchy to guide attention.','Reveal advanced options when people need them.'],notableTerms:[],actionItems:['Simplify the first screen of the new project.','Test the revised flow with five participants.'],chapters:[],quotations:[]}}]};
function Navigation({view='captions'}:{view?:string}){return <div className="header-actions"><Button className="icon-button" aria-label="Show audio overlay" aria-pressed={view==='captions'}><AudioLines/></Button><Button className="icon-button" aria-label="Open history" aria-pressed={view==='history'}><History/></Button><Button className="icon-button" aria-label="Open settings" aria-pressed={view==='settings'}><Settings2/></Button></div>;}
function controls(translation=true){return {input:'system' as const,setInput:noop,captionMode:translation?'translate' as const:'subtitles' as const,setCaptionMode:noop,source:'en',setSource:noop,target:'es',setTarget:noop,silence:{timeoutSeconds:30,thresholdDbfs:-60},setSilence:noop,microphoneGain:1,setMicrophoneGain:noop,desktopGain:1,setDesktopGain:noop,translatedVolume:1,setTranslatedVolume:noop,microphoneMuted:false,setMicrophoneMuted:noop,desktopMuted:false,setDesktopMuted:noop,translatedMuted:false,setTranslatedMuted:noop,translationContext:context,setTranslationContext:noop,active:false,systemAudio:true,applicationAudio:true,platform:'macos',captureSourceId:'all',setCaptureSourceId:noop,inputGain:true,translatedPlayback:true};}
function CaptionPanel({translation=false,compact=false,large=false}:{translation?:boolean;compact?:boolean;large?:boolean}){
 const [open,setOpen]=useState<ControlGroup|null>(null);
 const props={...controls(translation),active:true};
 const style={'--overlay-background':'#191919','--overlay-border':'#444','--overlay-border-width':'1px','--overlay-radius':'20px','--overlay-font':'system-ui','--overlay-opacity':1,'--overlay-text-opacity':1,'--overlay-font-weight':400,'--overlay-source-text':'#adadad','--overlay-text':'#f1f1f1','--overlay-controls-opacity':1} as CSSProperties;
 return <main data-platform="macos" className="subtitle-panel custom-overlay" style={style}>
  <header className="panel-header"><div className="header-leading"><CaptureStatus {...props} status="live" playing={false} onOpen={setOpen} paused/></div><Navigation/></header>
  <div className="page-content"><LiveCaptions source={translation?'Every great idea starts with a little curiosity.':compact?'A clearer experience starts with less distraction.':large?'Every word, your way.':'The best ideas begin with a little curiosity.'} translation={translation?'Toda gran idea empieza con un poco de curiosidad.':''} sourceLanguage="en" targetLanguage="es" size={compact?26:translation?29:36}/><Button className="content-session-toggle is-stop" aria-label="Stop captions"><Square/><span>Stop captions</span></Button></div>
  <CaptionToolbar {...props} open={open} setOpen={setOpen} detached={false}/>
 </main>;
}
function HistoryPanel(){return <main data-platform="macos" className="subtitle-panel expanded settings-surface"><header className="panel-header settings-header"><div className="header-leading"><h1 className="visually-hidden">History</h1></div><Navigation view="history"/></header><div className="page-content"><section className="history-list" aria-label="Saved history"><section className="history-group"><h2>Preferences</h2><div className="settings-panel history-preferences"><label className="setting-toggle"><span>Save sessions</span><input type="checkbox" checked readOnly/></label></div></section><section className="history-group"><div className="history-section-heading"><h2>Sessions</h2><p className="history-sync-status">Synced · Latest 100</p></div><div className="settings-panel history-sessions"><HistoryRows rows={sampleRows} onSummary={noop} onExport={noop} onDelete={noop}/></div></section></section></div></main>;}
function ControlPanel({group}:{group:ControlGroup}){return <div className="detached-controls"><AudioControls {...controls()} group={group}/></div>;}
function AppearancePanel(){
 const [appearance,setAppearance]=useState({...defaultOverlayAppearance,backgroundColor:'#191919',backgroundOpacity:1,fontSize:36,borderRadius:20,borderWidth:1,borderOpacity:1});
 return <main data-platform="macos" className="subtitle-panel expanded settings-surface"><header className="panel-header settings-header"><div className="header-leading"><Button className="settings-back"><ArrowLeft/><span>Settings</span></Button></div><Navigation view="settings"/></header><div className="page-content"><h1 className="settings-section-title">Overlay</h1><OverlaySettings appearance={appearance} setAppearance={setAppearance} showSource setShowSource={noop} autoHide={false} setAutoHide={noop} opaque setOpaque={noop} transparencySupported={false}/></div></main>;
}
const shot=Math.min(6,Math.max(1,Number(new URLSearchParams(location.search).get('shot'))||1));
const copy=[
 ['Live captions for your audio','Caption desktop audio, individual apps, or your microphone.'],
 ['Translate speech in real time','See original speech and translated captions together.'],
 ['Add context from your screen','Include the topic, names, and terminology.'],
 ['Access your session history','Revisit saved sessions across your devices.'],
 ['Summarize sessions and ask questions','Get key points, action items, and answers.'],
 ['Customize your caption overlay','Adjust text size, font, colors, and appearance.'],
];
function Showcase(){return <div className={`showcase shot-${shot}`}><header className="showcase-copy"><h1>{copy[shot-1][0]}</h1><p>{copy[shot-1][1]}</p></header>
 {shot===1&&<><div className="hero-caption app-shadow"><CaptionPanel/></div><div className="input-window control-window app-shadow"><ControlPanel group="input"/></div><div className="audio-window control-window app-shadow"><ControlPanel group="audio"/></div></>}
 {shot===2&&<><div className="translation-caption app-shadow"><CaptionPanel translation/></div><div className="language-window control-window app-shadow"><ControlPanel group="languages"/></div></>}
 {shot===3&&<><div className="context-caption app-shadow"><CaptionPanel compact/></div><div className="context-window control-window app-shadow"><div className="detached-controls"><ContextSettings value={context} onChange={noop} active={false} onFillFromScreen={noop} onRefillContextFromSession={noop} refillContextSessions={[{id:'sample',label:'Designing for focus'}]}/></div></div></>}
 {shot===4&&<div className="history-window app-shadow"><HistoryPanel/></div>}
 {shot===5&&<div className="summary-window"><SessionIntelligence row={summaryRow} session={{user:{id:'app-store-fictional-fixture'}} as Session} onSaved={noop} onClose={noop} onSubscription={noop}/></div>}
 {shot===6&&<><div className="appearance-caption app-shadow"><CaptionPanel large/></div><div className="appearance-window app-shadow"><AppearancePanel/></div></>}
 </div>;}
createRoot(document.getElementById('root')!).render(<Showcase/>);
