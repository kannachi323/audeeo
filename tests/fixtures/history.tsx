import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HistoryRows} from '../../src/components/HistoryRows';
import {SaveSessionsDialog} from '../../src/components/SaveSessionsDialog';
import {Select} from '../../src/components/Select';
import {translationTargets} from '../../shared/languages';
import '../../src/styles.css';
function Fixture(){
 const [saving,setSaving]=useState(true),[confirm,setConfirm]=useState<boolean|null>(null);
 const [summary,setSummary]=useState(new URLSearchParams(location.search).has('summary'));
 const [language,setLanguage]=useState('fr');
 return <main className="subtitle-panel expanded settings-surface" style={{width:720,maxWidth:'100%',minHeight:500}}>
  <header className="panel-header settings-header"><h1>History</h1></header>
  <div className="page-content"><section className="history-list" aria-label="Saved history">
   <section className="history-group"><h2>Preferences</h2><div className="settings-panel history-preferences">
   <label className="setting-toggle"><span>Save sessions</span><input type="checkbox" checked={saving} onChange={e=>setConfirm(e.target.checked)}/></label>
   </div></section>
   <section className="history-group"><div className="history-section-heading"><h2>Sessions</h2><p className="history-sync-status" role="status">Saved on this device · waiting to sync · Latest 100</p></div><div className="settings-panel history-sessions">
   <HistoryRows rows={saving ? ['Physics lecture','Weekly planning','Language practice'].map((title,i)=>({id:String(i),summary_title:title,started_at:'2026-09-15T12:00:00Z',source_language:'en',target_language:'zh',segments:[],session_summaries:[]})) : []} onSummary={()=>setSummary(true)} onExport={()=>{}} onDelete={()=>{}}/>

   </div></section>
  </section></div>
  {confirm!==null && <SaveSessionsDialog enabled={confirm} pending={false} issue="" onCancel={()=>setConfirm(null)} onConfirm={()=>{setSaving(confirm);setConfirm(null);}}/>}
  {summary && <div className="dialog-backdrop"><section className="intelligence-dialog" role="dialog" aria-modal="true" aria-label="Session summary">
   <header><strong>Session summary</strong><button className="button" onClick={()=>setSummary(false)}>Close summary</button></header>
   <div className="intelligence-controls">
    <label>Output language<Select label="Summary output language" value={language} onChange={setLanguage} options={translationTargets}/></label>
    <label>Instructions <span>(optional)</span><textarea placeholder="What should the summary focus on?"/></label>
   </div>
  </section></div>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
