import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../AuthContext'
import { getSubscription, getSubscriptionPlans, type SubscriptionPlan } from '../lib/subscriptions'

export function Pricing() {
  const { session } = useAuth()
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [isPro, setIsPro] = useState(false)

  useEffect(() => {
    if (!session) return
    let active = true
    void Promise.all([getSubscriptionPlans(session), getSubscription(session)])
      .then(([nextPlans, subscription]) => {
        if (active) { setPlans(nextPlans); setIsPro(subscription.active) }
      })
      .catch(() => { if (active) setPlans([]) })
    return () => { active = false }
  }, [session])

  const monthly = plans.find((plan) => plan.id === 'monthly')
  const yearly = plans.find((plan) => plan.id === 'yearly')

  return (
    <div className="public-page">
      <header className="public-page-header centered">
        <h1>Pricing</h1>
      </header>
      <section className="pricing-grid" aria-label="Audeeo plans">
        <article className="pricing-card">
          <p className="page-label">Free</p><h2>Audeeo</h2><p className="price">Free</p><p className="price-note">Development access</p>
          <ul><li><Check />Live microphone captions</li><li><Check />Caption overlay</li><li><Check />Local display preferences</li></ul>
          <Link className="button outline" to={session ? '/' : '/register'}>{session ? 'Open Audeeo' : 'Create account'}</Link>
        </article>
        <article className="pricing-card featured">
          <div className="pricing-heading"><div><p className="page-label">Paid</p><h2>Audeeo Pro</h2></div><span>Pro</span></div>
          <p className="price">{monthly?.price ?? 'Store pricing'}{monthly && <small> / month</small>}</p>
          <p className="price-note">{yearly ? `${yearly.price} yearly option available` : 'Monthly and yearly options'}</p>
          <ul><li><Check />Everything in Audeeo</li><li><Check />Translation and generated audio</li><li><Check />Subscription status across devices</li></ul>
          {session ? <button className="button primary" type="button" disabled={isPro}>{isPro ? 'Current plan' : 'View options in the Audeeo app'}</button> : <Link className="button primary" to="/signin" state={{ from: '/pricing' }}>Sign in to view pricing</Link>}
        </article>
      </section>
      <p className="pricing-disclaimer">Final pricing will appear here when the release offering is available.</p>
    </div>
  )
}
