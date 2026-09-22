// Visual QA uses production components and sample data; no billing or account mutations.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,AudioLines,History,Settings2} from 'lucide-react';
import {SubscriptionOverview,UsageOverview} from '../../src/components/Subscriptions';
import {MinutePackView} from '../../src/components/MinutePacks';
import {AccountProfile} from '../../src/components/AccountProfile';
import {DailyBudgetDialog} from '../../src/components/DailyBudgetDialog';
import {OverlaySettings} from '../../src/components/OverlaySettings';
import {LegalFooter} from '../../src/components/LegalLinks';
import {Button} from '../../src/components/Button';
import {defaultOverlayAppearance} from '../../src/lib/overlayAppearance';
import {normalizeDailyBudget} from '../../src/lib/dailyBudget';
import '../../src/styles.css';
function Fixture(){
  const query=new URLSearchParams(location.search),overlay=query.get('page')==='overlay';
  if(query.has('full')) { document.documentElement.style.cssText='height:auto;overflow:auto'; document.body.style.cssText='height:auto;overflow:visible'; document.getElementById('root')!.style.cssText='height:auto;overflow:visible'; }
  const [daily,setDaily]=useState({...normalizeDailyBudget(null),minutes:60 as number|null,usedSeconds:2700});
  const [editing,setEditing]=useState(false),[appearance,setAppearance]=useState(defaultOverlayAppearance);
  const [showSource,setShowSource]=useState(true),[autoHide,setAutoHide]=useState(true),[opaque,setOpaque]=useState(false);
  const free=query.has('free'),loading=query.has('loading'),empty=query.has('empty'),unavailable=query.has('unavailable');
  const usage={active:!free,unlimited:query.has('unlimited'),usedSeconds:free?(empty?1800:0):7800,includedSeconds:free?1800:36000,remainingSeconds:free?(empty?0:1800):28200,purchasedSeconds:free?0:10800,periodStart:null,periodEnd:free?null:'2026-10-01T00:00:00',subscription:null};
  const user={id:'fixture',email:'alex@example.com',user_metadata:{name:'Alex'},app_metadata:{provider:'google'}} as any;
  return <main className="subtitle-panel expanded settings-surface" style={{width:'100%',maxWidth:query.has('wide')?1040:720,height:query.has('full')?'auto':500,maxHeight:'none',margin:'0 auto'}}>
    <header className="panel-header settings-header"><div className="header-leading"><Button className="settings-back"><ArrowLeft/>Settings</Button></div><div className="header-actions"><Button className="icon-button" aria-label="Show audio overlay"><AudioLines/></Button><Button className="icon-button" aria-label="History"><History/></Button><Button className="icon-button" aria-label="Settings"><Settings2/></Button></div></header>
    <div className="page-content" style={query.has('full')?{overflow:'visible'}:undefined}>
      <h1 className="settings-section-title">{overlay?'Overlay':'Account'}</h1>
      {overlay?<OverlaySettings {...{appearance,setAppearance,showSource,setShowSource,autoHide,setAutoHide,opaque,setOpaque}}/>:<section className="account-section">
        <AccountProfile user={user} disabled={false} onSignOut={()=>{}}/>
        <div className="account-plan-grid">
          <section className="account-group"><h2>Subscription</h2><div className="settings-panel subscription-settings"><SubscriptionOverview busy={loading} info={loading||unavailable?null:free?{active:false}:{active:true,productID:'monthly',paidPrice:'$9.99',billingPeriod:'month',expiresAt:'2026-10-15T00:00:00',willRenew:true,managementURL:null}} usage={loading||unavailable?null:usage} actions={<div className="subscription-actions"><Button className="subscription-action">Manage subscription</Button><Button className="subscription-action">Restore purchases</Button></div>}>{free && <><Button>Yearly · $80.00 / year</Button><Button>Monthly · $8.00 / month</Button></>}</SubscriptionOverview></div></section>
          <section className="account-group"><h2>Usage</h2><div className="settings-panel usage-settings"><UsageOverview usage={loading||unavailable?null:usage} busy={loading} dailyBudget={daily} onEdit={()=>setEditing(true)}/></div></section>
        </div>
        <MinutePackView loading={loading} offers={unavailable?[]:[{id:'minutes_60',minutes:60,price:'$3.00',productID:'fixture-60'},{id:'minutes_180',minutes:180,price:'$8.00',productID:'fixture-180'},{id:'minutes_600',minutes:600,price:'$20.00',productID:'fixture-600'}]} catalogMessage={unavailable?'Prices are unavailable. Retry to load them.':''} onRetry={()=>{}} onBuy={()=>{}}/>
        <section className="account-group"><h2>Account controls</h2><div className="settings-panel account-controls"><div><h3>Delete account</h3><Button className="account-delete">Delete account</Button></div></div></section>
        {editing && <DailyBudgetDialog minutes={daily.minutes} onApply={minutes=>setDaily({...daily,minutes})} onClose={()=>setEditing(false)}/>}
      </section>}
    </div>
    {!overlay && <LegalFooter build={{platform:'macos',distribution:query.has('store')?'app-store':'direct'}}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
