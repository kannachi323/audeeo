// Visual QA with sample data; no subscription requests or account actions.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft, AudioLines, Settings2, UserRound, LogOut, RotateCcw, Trash2} from 'lucide-react';
import {SubscriptionOverview} from '../../src/components/Subscriptions';
import {Button} from '../../src/components/Button';
import '../../src/styles.css';

createRoot(document.getElementById('root')!).render(
  <main className="subtitle-panel expanded" style={{maxWidth:720, height:500}}>
    <header className="panel-header settings-header">
      <Button className="settings-back"><ArrowLeft/>Settings</Button>
      <div className="header-actions"><Button className="icon-button" aria-label="Show audio overlay"><AudioLines/></Button><Button className="icon-button" aria-label="Settings"><Settings2/></Button></div>
    </header>
    <div className="page-content">
      <h2 className="settings-section-title">Account</h2>
      <section className="account-section">
        <div className="account-profile"><UserRound/><div className="account-identity"><small>Signed in as</small><span>alex@example.com</span></div><Button className="icon-button" aria-label="Sign out"><LogOut/></Button></div>
        <section className="subscription-settings">
          <SubscriptionOverview busy={false} info={{active:true, productID:'rc_promo_audeeo_pro_custom', expiresAt:'2027-09-15T20:01:52Z', willRenew:false, managementURL:null}} usage={{active:true, unlimited:true, usedSeconds:588, includedSeconds:null, remainingSeconds:null, periodStart:null, periodEnd:null, subscription:null}}/>
          <div className="subscription-actions"><Button className="subscription-action"><RotateCcw/>Restore purchases</Button></div>
        </section>
        <Button className="account-delete"><Trash2/>Delete account</Button>
      </section>
    </div>
  </main>
);
