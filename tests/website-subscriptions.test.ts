import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
  changeUser: vi.fn(),
  getCustomerInfo: vi.fn(),
  getOfferings: vi.fn(),
  purchase: vi.fn(),
}))

vi.mock('../website/src/lib/config', () => ({
  config: {
    revenueCatWebKey: 'rcb_test_key',
    relayUrl: 'https://relay.example.test/',
  },
}))

vi.mock('@revenuecat/purchases-js', () => {
  class PurchasesError extends Error {
    constructor(readonly errorCode: number) { super('RevenueCat error') }
  }
  return {
    Purchases: { configure: mocks.configure },
    PurchasesError,
    ErrorCode: { UserCancelledError: 1 },
  }
})

const session = {
  access_token: 'supabase-token',
  user: { id: 'owner-a', email: 'customer@example.test' },
} as any

const pro = {
  entitlements: {
    active: {
      audeeo_pro: {
        productIdentifier: 'web_yearly',
        expirationDate: new Date('2027-09-14T00:00:00Z'),
        willRenew: true,
      },
    },
  },
  managementURL: 'https://billing.example.test/manage',
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.configure.mockReturnValue(mocks)
  mocks.changeUser.mockResolvedValue(pro)
  mocks.getCustomerInfo.mockResolvedValue(pro)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ active: true, usedSeconds: 60, includedSeconds: 36000, remainingSeconds: 35940 }),
  }))
})

it('purchases the selected web package and reconciles server allowance', async () => {
  const annual = { identifier: '$rc_annual', webBillingProduct: { currentPrice: { formattedPrice: '$79.99' } } }
  mocks.getOfferings.mockResolvedValue({ current: { annual } })
  mocks.purchase.mockResolvedValue({ customerInfo: pro })
  const { purchaseSubscription } = await import('../website/src/lib/subscriptions')

  const result = await purchaseSubscription(session, 'yearly')

  expect(result).toMatchObject({ info: { active: true }, allowanceSynced: true, usage: { usedSeconds: 60 } })
  expect(mocks.purchase).toHaveBeenCalledWith({ rcPackage: annual, customerEmail: session.user.email })
  expect(fetch).toHaveBeenCalledWith('https://relay.example.test/v1/purchases/restore', expect.objectContaining({
    method: 'POST',
    headers: { Authorization: 'Bearer supabase-token' },
  }))
})

it('keeps the paid entitlement visible when allowance reconciliation is offline', async () => {
  const monthly = { identifier: '$rc_monthly', webBillingProduct: { currentPrice: { formattedPrice: '$9.99' } } }
  mocks.getOfferings.mockResolvedValue({ current: { monthly } })
  mocks.purchase.mockResolvedValue({ customerInfo: pro })
  vi.mocked(fetch).mockRejectedValue(new Error('offline'))
  const { purchaseSubscription } = await import('../website/src/lib/subscriptions')

  await expect(purchaseSubscription(session, 'monthly')).resolves.toMatchObject({
    info: { active: true },
    allowanceSynced: false,
  })
})

it('treats closing checkout as cancellation and does not reconcile', async () => {
  const monthly = { identifier: '$rc_monthly', webBillingProduct: { currentPrice: { formattedPrice: '$9.99' } } }
  mocks.getOfferings.mockResolvedValue({ current: { monthly } })
  const { PurchasesError, ErrorCode } = await import('@revenuecat/purchases-js')
  mocks.purchase.mockRejectedValue(new PurchasesError(ErrorCode.UserCancelledError))
  const { purchaseSubscription } = await import('../website/src/lib/subscriptions')

  await expect(purchaseSubscription(session, 'monthly')).resolves.toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it('changes RevenueCat identity before loading another signed-in account', async () => {
  const { getSubscription } = await import('../website/src/lib/subscriptions')
  await getSubscription(session)
  await getSubscription({ ...session, user: { ...session.user, id: 'owner-b' } })

  expect(mocks.configure).toHaveBeenCalledTimes(1)
  expect(mocks.changeUser).toHaveBeenCalledWith('owner-b')
})
