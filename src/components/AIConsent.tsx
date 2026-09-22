import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {User} from '@supabase/supabase-js';
import {SignOutButton} from './SignOutButton';
import {Button} from './Button';
import {LegalFooter} from './LegalLinks';
import audeeoLogo from '../../assets/audeeo-logo.png';

type Purpose = 'captions' | 'analysis' | 'screenshot';
const prefix = 'audeeo.ai-consent.v3.';
const changed = 'audeeo-ai-consent-changed';
function snapshot(owner?:string) {
  try { return owner ? localStorage.getItem(`${prefix}${owner}`) || '' : ''; }
  catch { return ''; }
}
function permissions(owner?:string) {
  const value = snapshot(owner);
  return value === 'accepted';
}
function subscribe(listener:()=>void) {
  window.addEventListener(changed,listener);
  window.addEventListener('storage',listener);
  return ()=>{window.removeEventListener(changed,listener);window.removeEventListener('storage',listener);};
}
export function grantAIConsent(owner:string) {
  localStorage.setItem(`${prefix}${owner}`,'accepted');
  window.dispatchEvent(new Event(changed));
}
export function withdrawAIConsent(owner:string) {
  localStorage.removeItem(`${prefix}${owner}`);
  localStorage.removeItem(`audeeo.ai-consent.v2.${owner}`);
  for (const purpose of ['captions','analysis','screenshot']) localStorage.removeItem(`audeeo.ai-consent.v1.${owner}.${purpose}`);
  window.dispatchEvent(new Event(changed));
}
export function useAIConsent(owner?:string) {
  useSyncExternalStore(subscribe,()=>snapshot(owner),()=> '');
  const accepted = permissions(owner);
  // Read again at action time, including permission withdrawn in another window.
  const requestConsent = async (_purpose:Purpose) => permissions(owner);
  return {requestConsent, accepted, screenAllowed:accepted};
}

export function AIConsentSetup({owner,user,onContinue,onBack,onSignOut,onAccount}:{
  owner:string;user?:User;onContinue:()=>void;onBack?:()=>void;onSignOut:()=>void;onAccount?:()=>void;
}) {
  const [issue,setIssue]=useState('');
  const [reachedEnd,setReachedEnd]=useState(false);
  const agreement=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    setReachedEnd(false);
    setIssue('');
    const box=agreement.current;
    if (!box) return;
    box.scrollTop=0;
    // If accessibility/layout changes make all text visible, no scroll is needed.
    const checkFits=()=>{if(box.clientHeight>0 && box.scrollHeight<=box.clientHeight+1)setReachedEnd(true);};
    checkFits();
    const observer=typeof ResizeObserver==='undefined' ? undefined : new ResizeObserver(checkFits);
    observer?.observe(box);
    return ()=>observer?.disconnect();
  },[owner]);
  return <main className="desktop-onboarding ai-setup" aria-label="AI setup">
    <div className="onboarding-content">
    <section className="desktop-onboarding-card">
      {onBack && <Button variant="outline" className="onboarding-back" onClick={onBack}>Back</Button>}
      <header className="onboarding-heading"><img className="desktop-onboarding-logo" src={audeeoLogo} alt="Audeeo"/><h1>Enable AI features</h1></header>
      <div ref={agreement} className="ai-setup-details" role="region" aria-label="AI data use and terms" tabIndex={0}
        aria-describedby={reachedEnd ? undefined : 'ai-agreement-scroll-help'} onScroll={event=>{
          const box=event.currentTarget;
          if(box.clientHeight>0 && box.scrollTop+box.clientHeight>=box.scrollHeight-2)setReachedEnd(true);
        }}>
        <p>Audeeo uses third-party AI to create captions, translations, summaries, and answers.</p>
        <ul>
          <li><strong>Audio and context</strong> go through Audeeo’s server to Soniox for captions, translations, and optional spoken translation.</li>
          <li><strong>Session analysis</strong> sends the transcript, instructions, and questions to OpenAI when you request a summary or answer.</li>
        </ul>
        <div className="ai-screen-disclosure"><strong>Screen context</strong><p>Screen context is included in this agreement. When you click Fill from screen, your entire main display is captured and sent through Audeeo’s server to OpenAI. Hide private content first. Screenshots are not saved in session history.</p></div>
        <p>Providers process data under their own retention policies. You can stop capture or delete your account in Account settings. AI features require permission; account management remains available.</p>
        <p>By choosing Agree and continue, you agree to Audeeo’s Terms of Use and consent to all AI processing described here, including screen context. The Privacy Policy explains data retention and your choices.</p>
      </div>
      {!reachedEnd && <p id="ai-agreement-scroll-help" className="ai-scroll-hint" role="status">Scroll to the bottom to continue.</p>}
      {issue && <p role="alert">{issue}</p>}
      <Button className="onboarding-primary" disabled={!reachedEnd} onClick={()=>{
        if (!reachedEnd) return;
        try { grantAIConsent(owner);onContinue(); }
        catch { setIssue('Could not save your permission. Please try again.'); }
      }}>Agree and continue</Button>
      {onAccount && <Button variant="outline" onClick={onAccount}>Account &amp; billing</Button>}
      <SignOutButton user={user} onSignOut={onSignOut}/>
    </section>
    </div>
    <LegalFooter/>
  </main>;
}
