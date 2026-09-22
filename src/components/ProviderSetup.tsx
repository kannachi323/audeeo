import { useState } from 'react';
import { Button } from './Button';
import { emptyProviderKeys, personalKey, providerName, saveProviderKeys, type ProviderId, type ProviderKeys, type ProviderMode } from '../lib/providers';

export function ProviderSetup({keys,mode,disabled=false,onChange,onBack}:{
  keys:ProviderKeys;mode:ProviderMode;disabled?:boolean;
  onChange:(mode:ProviderMode,keys:ProviderKeys)=>void;onBack?:()=>void;
}) {
  const [provider,setProvider]=useState<ProviderId>(mode==='openai'?'openai':'soniox');
  const [draft,setDraft]=useState<ProviderKeys>(()=>({...keys}));
  const [busy,setBusy]=useState(false);
  const [issue,setIssue]=useState('');
  const [consent,setConsent]=useState(false);
  async function complete() {
    setIssue('');setBusy(true);
    try {
      personalKey(provider,draft);
      if (!consent) throw new Error('Confirm provider processing to continue.');
      const next={...draft,[provider]:draft[provider].trim()};
      await saveProviderKeys(next);
      onChange(provider,next);
    } catch(error) {setIssue(error instanceof Error ? error.message : 'Could not save your key.');}
    finally {setBusy(false);}
  }
  return <section className="provider-setup" aria-label="Caption service">
    <h1>Caption service</h1>
    <p>Use your own API key, or sign in for Audeeo’s managed service.</p>
    <form onSubmit={event=>{event.preventDefault();void complete();}}>
      <label htmlFor="byok-provider">Provider</label>
      <select id="byok-provider" value={provider} disabled={disabled||busy} onChange={event=>{setProvider(event.target.value as ProviderId);setConsent(false);setIssue('');}}>
        <option value="soniox">Soniox</option><option value="openai">OpenAI</option>
      </select>
      <label htmlFor="byok-key">{providerName(provider)} API key</label>
      <input id="byok-key" type="password" autoComplete="off" spellCheck={false} value={draft[provider]} disabled={disabled||busy} onChange={event=>setDraft({...draft,[provider]:event.target.value})}/>
      <p className="provider-detail">{provider==='soniox'?'Captions and text translation.':'Captions, text translation, and spoken translation.'} Your provider bills you directly. No Audeeo account is required.</p>
      <p className="provider-detail">Keys stay on this device and are sent only to the selected provider. Desktop storage uses a file restricted to your OS user account.</p>
      <label className="provider-consent"><input type="checkbox" checked={consent} disabled={disabled||busy} onChange={event=>setConsent(event.target.checked)}/>Send captured audio{provider==='soniox'?' and supplied context':''} directly to {providerName(provider)} when I start a session.</label>
      <Button type="submit" disabled={disabled||busy||!consent||!draft[provider].trim()}>{busy?'Saving…':'Use my key'}</Button>
    </form>
    {issue&&<p role="alert">{issue}</p>}
    <div className="provider-other">
      <Button variant="outline" disabled={disabled||busy} onClick={()=>onChange('audeeo',keys)}>Use Audeeo account</Button>
      {(keys.soniox||keys.openai)&&<Button variant="outline" disabled={disabled||busy} onClick={async()=>{
        setBusy(true);setIssue('');try{const empty=emptyProviderKeys();await saveProviderKeys(empty);setDraft(empty);onChange('audeeo',empty);}catch{setIssue('Could not remove saved keys.');}finally{setBusy(false);}
      }}>Remove saved keys</Button>}
      {onBack&&<Button variant="outline" disabled={busy} onClick={onBack}>Back</Button>}
    </div>
  </section>;
}
