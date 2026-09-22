export type AccountUsage = {
  sandbox?: { subscriptionActive: boolean; purchasedSeconds: number; productId: string | null; expiresAt: string | null };
  packsEnabled?: boolean;
  purchasedSeconds?: number;
  purchaseRevision?: number;
  totalRemainingSeconds?: number | null;
  active: boolean;
  unlimited: boolean;
  usedSeconds: number;
  includedSeconds: number | null;
  remainingSeconds: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  subscription: null | {
    id: string;
    customerId: string;
    entitlementId: string;
    productId: string;
    store: string | null;
    active: boolean;
    checkedAt: string;
  };
};

export type SubscriptionSync = AccountUsage & { expiresAt: string | null };
