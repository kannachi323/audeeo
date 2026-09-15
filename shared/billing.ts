export type AccountUsage = {
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
