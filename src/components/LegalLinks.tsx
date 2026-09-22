import {useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
export function LegalLinks() {
  const [issue,setIssue]=useState('');
  return <><nav onClick={event=>{
    const link=(event.target as HTMLElement).closest('a');
    if (!link || !isTauri()) return;
    event.preventDefault();
    void invoke('open_external_url',{url:link.href}).catch(()=>setIssue('Could not open your browser. Visit audeeo.app for policies and support.'));
  }} className="legal-links" aria-label="Legal and support">
    <a href="https://audeeo.app/privacy" target="_blank" rel="noreferrer">Privacy</a>
    <a href="https://audeeo.app/terms" target="_blank" rel="noreferrer">Terms</a>
    <a href="https://audeeo.app/support" target="_blank" rel="noreferrer">Support</a>
  </nav>{issue && <p role="status">{issue}</p>}</>;
}

export function LegalFooter({build}:{build?:{platform:string;distribution:string}} = {}) {
  const platformName = build && ({macos:'macOS',windows:'Windows',linux:'Linux',browser:'Web'}[build.platform]);
  const label = platformName && (build?.platform === 'macos' && build.distribution === 'app-store' ? 'macOS (App Store)' : platformName);
  return <footer className="app-legal-footer">
    {label && <p className="app-build-metadata" aria-label={`Build: ${label}`}>{label}</p>}
    <LegalLinks/>
  </footer>;
}
