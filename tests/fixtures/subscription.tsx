// Visual fixture using production styles, features, and disclosure. No billing requests.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft} from 'lucide-react';
import {SubscriptionSummary} from '../../src/components/SubscriptionSummary';
import {LegalFooter} from '../../src/components/LegalLinks';
import {Button} from '../../src/components/Button';
import logo from '../../assets/audeeo-logo.png';
import '../../src/styles.css';

const unavailable = new URLSearchParams(location.search).has('unavailable');
createRoot(document.getElementById('root')!).render(<main className="desktop-onboarding">
  <div className="onboarding-content"><section className="desktop-onboarding-card stage-subscription">
    <Button className="onboarding-back" variant="outline"><ArrowLeft/>Back</Button>
    <header className="onboarding-heading"><img className="desktop-onboarding-logo" src={logo} alt="Audeeo"/><h1>Audeeo Pro</h1></header>
    {!unavailable && <div className="onboarding-plan-grid" aria-label="Sample subscription plans">
      <button className="selected"><strong>Yearly</strong><span>$80 / year</span></button>
      <button><strong>Monthly</strong><span>$8 / month</span></button>
    </div>}
    <SubscriptionSummary apple plan={unavailable ? undefined : {id:'yearly',price:'$80',productID:'fixture-yearly'}}/>
    <Button className="onboarding-primary" disabled={unavailable}>Subscribe</Button>
    <Button className="onboarding-link" variant="outline">Restore purchases</Button>
    {unavailable && <p className="onboarding-message" role="status">Plans are unavailable right now. Please try again later.</p>}
  </section></div>
  <LegalFooter/>
</main>);
