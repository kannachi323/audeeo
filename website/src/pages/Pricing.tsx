import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../components/ui/accordion'
import {MinutePacks} from "../components/MinutePacks"
import {config} from '../lib/config'
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
        ? config.billingEnvironment==='sandbox' ? 'Test subscription confirmed. This does not grant live usage.' : 'Audeeo Pro is active. Sign in to the app with this same account.'
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
    <div className="public-page pricing-page">
      <header className="public-page-header centered">
        <h1>Pricing</h1>
        <p>Open source. Bring your own API key or subscribe.</p>
        {config.billingEnvironment==='sandbox' && <p role="status">Sandbox payments · Test cards only. No real charges. Test purchases do not add live usage.</p>}
      </header>
      <section className="pricing-grid" aria-label="Audeeo plans">
        {session ? <MinutePacks key={session.user.id} session={session}/> : <article className="pricing-card">
          <h2>Minute packs</h2>
          <p className="plan-description">Pay once. Minutes never expire.</p>
          <dl className="pack-prices"><div><dt>60 minutes</dt><dd>$3</dd></div><div><dt>180 minutes</dt><dd>$8</dd></div><div><dt>600 minutes</dt><dd>$20</dd></div></dl>
          <Link className="button outline" to="/signin" state={{from:'/pricing'}}>Buy minutes</Link>
        </article>}
        <article className="pricing-card featured">
          <h2>Audeeo Pro</h2>
          <p className="plan-description">600 usage minutes each month.</p>
          <p className="price">{monthly?.price ?? LAUNCH_MONTHLY_PRICE}<small> / month</small></p>
          <p className="price-note">{yearly?.price ?? LAUNCH_YEARLY_PRICE} / year</p>
          <p className="plan-renewal">Renews automatically. Cancel anytime.</p>
          {session ? (
            <div className="pricing-actions">
              {isPro ? <button className="button primary" type="button" disabled>Current plan</button> : <>
                {yearly && <button className="button primary" type="button" disabled={Boolean(buying) || loading} onClick={() => void buy('yearly')}>{buying === 'yearly' ? 'Opening checkout…' : `Choose yearly · ${yearly.price}`}</button>}
                {monthly && <button className="button outline" type="button" disabled={Boolean(buying) || loading} onClick={() => void buy('monthly')}>{buying === 'monthly' ? 'Opening checkout…' : `Choose monthly · ${monthly.price}`}</button>}
                {!loading && plans.length === 0 && <button className="button primary" type="button" disabled>Subscriptions unavailable</button>}
              </>}
            </div>
          ) : <Link className="button primary" to="/signin" state={{ from: '/pricing' }}>Subscribe</Link>}
        </article>
      </section>
      {message && <p className="pricing-message" role="status">{message}</p>}
      <Accordion className="pricing-details" type="single" collapsible>
        <AccordionItem value="minutes">
          <AccordionTrigger>How minutes work</AccordionTrigger>
          <AccordionContent>
          <p>Captions and text translation use 1× minutes; spoken translation uses 3×.</p>
          <p>Pro minutes reset monthly without rollover. Purchased minutes never expire.</p>
        </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
