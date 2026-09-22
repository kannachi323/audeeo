import {LoaderCircle} from 'lucide-react';

export function RefreshIndicator() {
  return <span className="account-refresh" role="status"><LoaderCircle aria-hidden="true"/>Updating…</span>;
}

export function AccountLoading({label,kind='plan'}:{label:string;kind?:'plan'|'usage'|'packs'}) {
  return <div className={`account-loading account-loading-${kind}`} role="status" aria-label={label}>
    <span className="visually-hidden">{label}</span>
    {kind==='packs' ? <div className="minute-pack-options" aria-hidden="true">{[0,1,2].map(i=><div className="skeleton skeleton-pack" key={i}/>)}</div> : <div aria-hidden="true" className="account-loading-content">
      <span className="skeleton skeleton-label"/>
      <span className="skeleton skeleton-number"/>
      <span className="skeleton skeleton-line"/>
      <span className="skeleton skeleton-line skeleton-short"/>
      <span className="skeleton skeleton-footer"/>
    </div>}
  </div>;
}
