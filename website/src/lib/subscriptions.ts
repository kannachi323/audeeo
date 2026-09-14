import type { CustomerInfo, Purchases as WebPurchases } from '@revenuecat/purchases-js'
import type { Session } from '@supabase/supabase-js'
import { config } from './config'

const PRO_ENTITLEMENT = 'audeeo_pro'

export type SubscriptionInfo = {
  active: boolean
  productId: string | null
  expiresAt: string | null
  willRenew: boolean
  managementUrl: string | null
}

export type SubscriptionPlan = {
  id: 'yearly' | 'monthly'
  price: string
}

let purchases: WebPurchases | undefined
let owner: string | undefined

function summarize(info: CustomerInfo): SubscriptionInfo {
  const entitlement = info.entitlements.active[PRO_ENTITLEMENT]
  return {
    active: Boolean(entitlement),
    productId: entitlement?.productIdentifier ?? null,
    expiresAt: entitlement?.expirationDate?.toISOString() ?? null,
    willRenew: entitlement?.willRenew ?? false,
    managementUrl: safeManagementUrl(info.managementURL),
  }
}

function safeManagementUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

async function client(session: Session) {
  if (!config.revenueCatWebKey) throw new Error('Web subscriptions are not configured yet.')
  const { Purchases } = await import('@revenuecat/purchases-js')
  if (!purchases) {
    purchases = Purchases.configure({ apiKey: config.revenueCatWebKey, appUserId: session.user.id })
    owner = session.user.id
  } else if (owner !== session.user.id) {
    await purchases.changeUser(session.user.id)
    owner = session.user.id
  }
  return purchases
}

export async function getSubscription(session: Session) {
  return summarize(await (await client(session)).getCustomerInfo())
}

export async function getSubscriptionPlans(session: Session): Promise<SubscriptionPlan[]> {
  const offering = (await (await client(session)).getOfferings()).current
  return (['yearly', 'monthly'] as const).flatMap((id) => {
    const plan = id === 'yearly' ? offering?.annual : offering?.monthly
    return plan ? [{ id, price: plan.webBillingProduct.currentPrice.formattedPrice }] : []
  })
}
