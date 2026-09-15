import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../AuthContext'
import { getSubscription, getSubscriptionPlans, purchaseSubscription, type SubscriptionPlan } from '../lib/subscriptions'

const LAUNCH_MONTHLY_PRICE = '$8'
const LAUNCH_YEARLY_PRICE = '$80'

export function Pricing() {
  const { session } = useAuth()
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [isPro, setIsPro] = useState(false)
  const [loading, setLoading] = useState(Boolean(session))
  const [buying, setBuying] = useState<SubscriptionPlan['id'] | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!session) { setLoading(false); return }
    let active = true
    setLoading(true)
    void Promise.all([getSubscriptionPlans(session), getSubscription(session)])
      .then(([nextPlans, subscription]) => {
        if (active) { setPlans(nextPlans); setIsPro(subscription.active) }
      })
      .catch((reason) => {
        if (active) {
          setPlans([])
          setMessage(reason instanceof Error ? reason.message : 'Could not load subscription options.')
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session])

  const buy = async (id: SubscriptionPlan['id']) => {
    if (!session || buying) return
    setBuying(id)
    setMessage('')
    try {
      const result = await purchaseSubscription(session, id)
      if (!result) return
      setIsPro(result.info.active)
      setMessage(result.allowanceSynced
        ? 'Audeeo Pro is active. Sign in to the app with this same account.'
        : 'Audeeo Pro is active, but your usage allowance could not be synced. Refresh your status before trying to purchase again.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Checkout failed. Please try again.')
    } finally {
      setBuying(null)
    }
  }

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
          <p className="price">{monthly?.price ?? LAUNCH_MONTHLY_PRICE}<small> / month</small></p>
          <p className="price-note">{yearly?.price ?? LAUNCH_YEARLY_PRICE} yearly option available</p>
          <ul><li><Check />Everything in Audeeo</li><li><Check />Translation and generated audio</li><li><Check />Subscription status across devices</li></ul>
          {session ? (
            <div className="pricing-actions">
              {isPro ? <button className="button primary" type="button" disabled>Current plan</button> : <>
                {yearly && <button className="button primary" type="button" disabled={Boolean(buying) || loading} onClick={() => void buy('yearly')}>{buying === 'yearly' ? 'Opening checkout…' : `Choose yearly · ${yearly.price}`}</button>}
                {monthly && <button className="button outline" type="button" disabled={Boolean(buying) || loading} onClick={() => void buy('monthly')}>{buying === 'monthly' ? 'Opening checkout…' : `Choose monthly · ${monthly.price}`}</button>}
                {!loading && plans.length === 0 && <button className="button primary" type="button" disabled>Subscriptions unavailable</button>}
              </>}
            </div>
          ) : <Link className="button primary" to="/signin" state={{ from: '/pricing' }}>Sign in to subscribe on the web</Link>}
        </article>
      </section>
      {message && <p className="pricing-message" role="status">{message}</p>}
      <p className="pricing-disclaimer">Web purchases unlock Audeeo Pro in the app when you sign in with the same account. Subscriptions renew automatically until cancelled.</p>
    </div>
  )
}
