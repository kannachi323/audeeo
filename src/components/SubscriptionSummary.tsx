import {useEffect, useId, useRef, useState} from 'react';
import {X} from 'lucide-react';
import {Button} from './Button';
import {LegalLinks} from './LegalLinks';
import {SubscriptionDisclosure} from './SubscriptionDisclosure';
import type {Plan} from '../lib/subscriptions';

export const AUDEEO_PRO_FEATURES = [
  'Live captions & translation',
  'Spoken translations',
  'Floating captions',
  'Synced history',
  'Summaries & Q&A',
  'Custom terminology',
] as const;

function SubscriptionInfoDialog({apple, onClose}:{apple:boolean; onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog ref={dialog} className="subscription-info-dialog" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()}>
    <header>
      <h2 id={title}>About Audeeo Pro</h2>
      <Button autoFocus variant="outline" aria-label="Close subscription details" onClick={close}><X aria-hidden="true"/></Button>
    </header>
    <div className="subscription-info-content">
      <section>
        <h3>What’s included</h3>
        <ul>
          <li>Live captions from desktop, application, and microphone audio.</li>
          <li>Real-time translation and spoken translation audio.</li>
          <li>A floating caption overlay and synced session history.</li>
          <li>Session summaries, questions and answers, and custom context and terminology.</li>
        </ul>
        <p>No provider API keys are needed. Cloud features require an internet connection.</p>
      </section>
      <section>
        <h3>Usage and billing</h3>
        <SubscriptionDisclosure apple={apple}/>
      </section>
      <section>
        <h3>Managing your subscription</h3>
        <p>Monthly and yearly prices are shown before purchase. Deleting the app or your Audeeo account does not cancel a store subscription. Use Restore purchases to recover an existing subscription.</p>
        <p>Purchased minutes never expire and remain available after cancellation.</p>
      </section>
      <LegalLinks/>
    </div>
  </dialog>;
}

export function SubscriptionMoreInfo({apple=true}:{apple?:boolean}) {
  const [infoOpen, setInfoOpen] = useState(false);
  return <>
    <button type="button" className="subscription-more-info" aria-haspopup="dialog" onClick={() => setInfoOpen(true)}>More info</button>
    {infoOpen && <SubscriptionInfoDialog apple={apple} onClose={() => setInfoOpen(false)}/>}
  </>;
}

export function SubscriptionSummary({apple=true, plan}:{apple?:boolean; plan?:Plan}) {
  return <div className="subscription-summary">
    <div className="subscription-summary-card">
      <p className="subscription-allowance"><strong>600 usage minutes / month</strong><span aria-live="polite">{plan ? `${plan.price} / ${plan.id === 'yearly' ? 'year' : 'month'}` : 'Price unavailable'}</span></p>
      <p>600 caption minutes, 200 spoken-translation minutes, or a mix.</p><ul className="onboarding-features">
        {AUDEEO_PRO_FEATURES.map(feature => <li key={feature}>{feature}</li>)}
      </ul>
    </div>
    <SubscriptionMoreInfo apple={apple}/>
  </div>;
}
