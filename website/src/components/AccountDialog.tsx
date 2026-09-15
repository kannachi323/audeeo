import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link } from 'react-router'
import { refreshSubscription, type SubscriptionInfo } from '../lib/subscriptions'
import type { AccountUsage } from '../../../shared/billing'

function minutes(seconds: number) {
  const value = seconds / 60
  return value > 0 && value < 10 && !Number.isInteger(value) ? value.toFixed(1) : Math.round(value).toLocaleString()
}

export function AccountDialog({ session, onClose, onSignOut }: {
  session: Session
  onClose: () => void
  onSignOut: () => Promise<void>
}) {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [usage, setUsage] = useState<AccountUsage | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  const refresh = async () => {
    setStatus('loading')
    setMessage('')
    try {
      const result = await refreshSubscription(session)
      setSubscription(result.info)
      setUsage(result.usage)
      if (!result.allowanceSynced) setMessage('Your RevenueCat status was found, but Audeeo could not sync your usage allowance. Try refreshing again; do not purchase twice.')
      setStatus('ready')
    } catch (reason) {
      setStatus('error')
      setMessage(reason instanceof Error ? reason.message : 'Could not check your subscription.')
    }
  }

  useEffect(() => { void refresh() }, [session])
  const active = usage?.active ?? subscription?.active ?? false

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="dialog-card account-card" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Close account"><X aria-hidden="true" /></button>
        <p className="page-label">Account</p>
        <h2 id="account-title">Your Audeeo plan</h2>
        <p className="account-email">{session.user.email}</p>
        <div className="plan-status-card">
          <div><span>Current plan</span><strong>{status === 'loading' ? 'Checking…' : active ? 'Audeeo Pro' : 'Free'}</strong></div>
          <span className={`status-badge ${active ? 'active' : ''}`}>{active ? 'Active' : 'Free'}</span>
          {subscription?.expiresAt && <p>{subscription.willRenew ? 'Renews' : 'Ends'} {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(subscription.expiresAt))}</p>}
          {usage && <p>{usage.unlimited
            ? `${minutes(usage.usedSeconds)} minutes used · unlimited account`
            : `${minutes(usage.usedSeconds)} of ${minutes(usage.includedSeconds ?? 0)} minutes used · ${minutes(usage.remainingSeconds ?? 0)} remaining`}</p>}
        </div>
        {message && <p className="auth-message error" role="alert">{message}</p>}
        <div className="account-actions">
          {subscription?.managementUrl && <a className="button primary" href={subscription.managementUrl} target="_blank" rel="noreferrer">Manage subscription <ExternalLink aria-hidden="true" /></a>}
          {!active && <Link className="button primary" to="/pricing" onClick={onClose}>Subscribe on the web</Link>}
          <button className="button outline" type="button" onClick={() => void refresh()} disabled={status === 'loading'}><RefreshCw aria-hidden="true" /> Refresh status</button>
        </div>
        <button className="text-button sign-out" type="button" onClick={() => void onSignOut().then(onClose)}>Sign out</button>
      </section>
    </div>
  )
}
