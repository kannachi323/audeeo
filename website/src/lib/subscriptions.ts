import type { CustomerInfo, Purchases as WebPurchases } from '@revenuecat/purchases-js'
import type { Session } from '@supabase/supabase-js'
import { config } from './config'
import type { AccountUsage } from '../../../shared/billing'

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
let operations = Promise.resolve()

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

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation)
  operations = result.then(() => undefined, () => undefined)
  return result
}

async function reconcile(session: Session): Promise<AccountUsage> {
  if (!config.relayUrl) throw new Error('Subscription syncing is not configured yet.')
  const response = await fetch(`${config.relayUrl.replace(/\/$/, '')}/v1/purchases/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Could not sync your subscription with Audeeo.')
  return response.json() as Promise<AccountUsage>
}

export function getSubscription(session: Session) {
  return exclusive(async () => summarize(await (await client(session)).getCustomerInfo()))
}

export function refreshSubscription(session: Session) {
  return exclusive(async () => {
    const info = summarize(await (await client(session)).getCustomerInfo())
    try {
      const usage = await reconcile(session)
      return { info, usage, allowanceSynced: true }
    } catch {
      return { info, usage: null, allowanceSynced: false }
    }
  })
}

export function getSubscriptionPlans(session: Session): Promise<SubscriptionPlan[]> {
  return exclusive(async () => {
    const offering = (await (await client(session)).getOfferings()).current
    return (['yearly', 'monthly'] as const).flatMap((id) => {
      const plan = id === 'yearly' ? offering?.annual : offering?.monthly
      return plan ? [{ id, price: plan.webBillingProduct.currentPrice.formattedPrice }] : []
    })
  })
}

export function purchaseSubscription(session: Session, id: SubscriptionPlan['id']) {
  return exclusive(async () => {
    const sdk = await client(session)
    const offering = (await sdk.getOfferings()).current
    const plan = id === 'yearly' ? offering?.annual : offering?.monthly
    if (!plan) throw new Error('That subscription option is not available. Please try again later.')
    const { PurchasesError, ErrorCode } = await import('@revenuecat/purchases-js')
    try {
      const result = await sdk.purchase({ rcPackage: plan, customerEmail: session.user.email })
      const info = summarize(result.customerInfo)
      if (!info.active) throw new Error('Checkout finished, but Audeeo Pro is not active yet. Refresh your status before trying again.')
      try {
        const usage = await reconcile(session)
        return { info, usage, allowanceSynced: true }
      } catch {
        return { info, usage: null, allowanceSynced: false }
      }
    } catch (reason) {
      if (reason instanceof PurchasesError && reason.errorCode === ErrorCode.UserCancelledError) return null
      throw reason
    }
  })
}
