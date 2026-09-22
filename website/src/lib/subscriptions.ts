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
    headers: { Authorization: `Bearer ${session.access_token}`, ...(config.billingEnvironment==='sandbox'?{'X-Audeeo-Billing-Environment':'sandbox'}:{}) },
    signal: AbortSignal.timeout(10_000),
  })
  const result=await response.json()
  if (!response.ok) throw new Error(result.error || 'Could not sync your subscription with Audeeo.')
  return result as AccountUsage
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
    if(config.billingEnvironment==='sandbox' && !(await reconcile(session)).sandbox) throw new Error('Sandbox checkout is unavailable for this account.')
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

export {type MinutePackOffer,type PackPurchaseResult} from '../../../shared/minutePacks'
import {minutePacks,type MinutePackId,type MinutePackOffer,type PackPurchaseResult} from '../../../shared/minutePacks'
export const refreshMinuteBalance=reconcile
export function getMinutePacks(session:Session):Promise<MinutePackOffer[]> {
 return exclusive(async()=>{
  const offering=(await (await client(session)).getOfferings()).all.minute_packs
  return minutePacks.flatMap(pack=>{const pkg=offering?.availablePackages.find(p=>p.identifier===pack.id && p.webBillingProduct.identifier===pack.web)
   return pkg?[{id:pack.id,minutes:pack.minutes,price:pkg.webBillingProduct.currentPrice.formattedPrice,productID:pack.web}]:[]})
 })
}
export function buyMinutePack(session:Session,id:MinutePackId):Promise<PackPurchaseResult> {
 return exclusive(async()=>{
  if(config.billingEnvironment==='sandbox' && !(await reconcile(session)).sandbox) throw new Error('Sandbox checkout is unavailable for this account.')
  const sdk=await client(session),pack=minutePacks.find(p=>p.id===id)
  const offering=(await sdk.getOfferings()).all.minute_packs
  const pkg=offering?.availablePackages.find(p=>p.identifier===id && p.webBillingProduct.identifier===pack?.web)
  if(!pkg)throw new Error('Minute pack unavailable.')
  const {PurchasesError,ErrorCode}=await import('@revenuecat/purchases-js')
  try{const result=await sdk.purchase({rcPackage:pkg,customerEmail:session.user.email});return {status:'pending',transactionId:result.storeTransaction.storeTransactionId,productID:pack!.web}}
  catch(e){if(e instanceof PurchasesError&&e.errorCode===ErrorCode.UserCancelledError)return {status:'cancelled'};throw e}
 })
}

export async function packPurchaseStatus(session:Session,transactionId:string,productID:string,after=0):Promise<import('../../../shared/minutePacks').PackPurchaseStatus> {
 const r=await fetch(`${config.relayUrl.replace(/\/$/,'')}/v1/purchases/status?transaction=${encodeURIComponent(transactionId)}&product=${encodeURIComponent(productID)}&after=${after}`,{headers:{Authorization:`Bearer ${session.access_token}`,...(config.billingEnvironment==='sandbox'?{'X-Audeeo-Billing-Environment':'sandbox'}:{})},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error('Purchase sync unavailable');return r.json();
}
