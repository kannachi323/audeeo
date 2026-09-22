import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  native: vi.fn(), invoke: vi.fn(), isTauri: vi.fn(() => false),
  configure: vi.fn(), changeUser: vi.fn(), getCustomerInfo: vi.fn(), getOfferings: vi.fn(),
  purchase: vi.fn(), presentPaywall: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri, invoke:mocks.invoke }));
vi.mock("../src/lib/account", () => ({ nativePurchase: mocks.native }));
vi.mock("../src/lib/config", () => ({ config: { revenueCatWebKey: "test_key", distribution:"app-store" } }));
vi.mock("@revenuecat/purchases-js", () => ({
  Purchases: { configure: mocks.configure },
  PurchasesError: class extends Error { errorCode = 1; },
  ErrorCode: { UserCancelledError: 1 },
}));
const session = { user: { id: "owner-a", email: "a@example.test" } } as any;
const pro = { entitlements: { active: { audeeo_pro: { productIdentifier: "yearly", willRenew: true, expirationDate: new Date("2027-09-12") } } }, managementURL: "https://billing.example.test/manage" };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.isTauri.mockReturnValue(false);
  mocks.configure.mockReturnValue(mocks);
  mocks.getCustomerInfo.mockResolvedValue(pro);
  mocks.changeUser.mockResolvedValue(pro);
});
it("checks the entitlement rather than the product or cancellation state", async () => {
  const { hasPro } = await import("../src/lib/subscriptions");
  expect(hasPro(pro as any)).toBe(true);
  expect(hasPro({ entitlements: { active: { unrelated: {} } } } as any)).toBe(false);
  expect(hasPro({ ...pro, entitlements: { active: { audeeo_pro: { willRenew: false } } } } as any)).toBe(true);
});
it("identifies the customer once and changes identity before reading a different account", async () => {
  const { customerInfo } = await import("../src/lib/subscriptions");
  expect((await customerInfo(session)).active).toBe(true);
  await customerInfo({ user: { id: "owner-b" } } as any);
  expect(mocks.configure).toHaveBeenCalledTimes(1);
  expect(mocks.configure).toHaveBeenCalledWith({ apiKey: "test_key", appUserId: "owner-a" });
  expect(mocks.changeUser).toHaveBeenCalledWith("owner-b");
});
it("uses the annual offering package and returned customer info", async () => {
  const pkg = { identifier: "$rc_annual" };
  mocks.getOfferings.mockResolvedValue({ current: { annual: pkg } });
  mocks.purchase.mockResolvedValue({ customerInfo: pro });
  const { subscriptionAction } = await import("../src/lib/subscriptions");
  expect((await subscriptionAction(session, "yearly"))?.active).toBe(true);
  expect(mocks.purchase).toHaveBeenCalledWith({ rcPackage: pkg, customerEmail: session.user.email });
});
it("keeps web checkout out of the native app", async () => {
  mocks.isTauri.mockReturnValue(true); mocks.native.mockResolvedValue({ active: true });
  const { subscriptionAction } = await import("../src/lib/subscriptions");
  await subscriptionAction(session, "yearly");
  await subscriptionAction(session, "paywall");
  await subscriptionAction(session, "manage");
  expect(mocks.native.mock.calls.map(call => call[0])).toEqual(["purchase:yearly", "paywall", "manage"]);
  expect(mocks.configure).not.toHaveBeenCalled();
});
it("uses RevenueCat web billing for the Windows desktop app", async () => {
  mocks.isTauri.mockReturnValue(true);
  const pkg = { identifier: "$rc_annual" };
  mocks.getOfferings.mockResolvedValue({ current: { annual: pkg } });
  mocks.purchase.mockResolvedValue({ customerInfo: pro });
  const { subscriptionAction } = await import("../src/lib/subscriptions");
  expect(await subscriptionAction(session, "yearly", "windows")).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledWith("open_external_url",{url:"https://audeeo.app/pricing"});
  expect(mocks.native).not.toHaveBeenCalled();
});
it("queues account switching until checkout finishes, including errors", async () => {
  let fail!: (error: Error) => void;
  mocks.presentPaywall.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const { subscriptionAction, customerInfo } = await import("../src/lib/subscriptions");
  const checkout = subscriptionAction(session, "paywall");
  const assertion = expect(checkout).rejects.toThrow("Network unavailable");
  await vi.waitFor(() => expect(fail).toBeDefined());
  const other = customerInfo({ user: { id: "b" } } as any);
  expect(mocks.changeUser).not.toHaveBeenCalled();
  fail(new Error("Network unavailable")); await assertion;
  await expect(other).resolves.toMatchObject({active:true});
  await expect(customerInfo(session)).resolves.toMatchObject({ active: true });
});
it("treats cancelled checkout as a normal outcome and rejects unsafe management URLs", async () => {
  const { PurchasesError } = await import("@revenuecat/purchases-js");
  mocks.presentPaywall.mockRejectedValue(new (PurchasesError as any)());
  const { subscriptionAction, subscriptionManagementURL } = await import("../src/lib/subscriptions");
  expect(await subscriptionAction(session, "paywall")).toBeNull();
  expect(subscriptionManagementURL({ managementURL: "javascript:alert(1)" } as any)).toBeNull();
  expect(subscriptionManagementURL({ managementURL: pro.managementURL } as any)).toBe(pro.managementURL);
});
it("reports missing packages without starting a purchase", async () => {
  mocks.getOfferings.mockResolvedValue({ current: null });
  const { subscriptionAction, subscriptionPlans } = await import("../src/lib/subscriptions");
  expect(await subscriptionPlans(session)).toEqual([]);
  await expect(subscriptionAction(session, "monthly")).rejects.toThrow("not available");
  expect(mocks.purchase).not.toHaveBeenCalled();
});
it('reads the customer paid price from subscription history',async()=>{
  mocks.getCustomerInfo.mockResolvedValue({...pro,subscriptionsByProductIdentifier:{yearly:{price:{formattedPrice:'€79.99'},periodType:'normal'}}});
  const {customerInfo}=await import('../src/lib/subscriptions');
  expect(await customerInfo(session)).toMatchObject({paidPrice:'€79.99',periodType:'normal'});
});

it('passes bulk quantity to one Apple checkout',async()=>{
 mocks.isTauri.mockReturnValue(true);mocks.native.mockResolvedValue({transactionId:'bulk-tx',cancelled:false});
 const {purchaseMinutePack}=await import('../src/lib/subscriptions');
 expect(await purchaseMinutePack(session,'minutes_180','macos',4)).toEqual({status:'pending',transactionId:'bulk-tx',productID:'audeeo_minutes_180'});
 expect(mocks.native).toHaveBeenCalledWith('pack:minutes_180:4',session);
 expect(mocks.native).toHaveBeenCalledTimes(1);
});
it.each([0,-1,11,1.5])('does not open checkout for invalid quantity %s',async quantity=>{
 mocks.isTauri.mockReturnValue(true);
 const {purchaseMinutePack}=await import('../src/lib/subscriptions');
 await expect(purchaseMinutePack(session,'minutes_60','macos',quantity)).rejects.toThrow('Choose between');
 expect(mocks.native).not.toHaveBeenCalled();expect(mocks.purchase).not.toHaveBeenCalled();
});
it('does not silently buy one pack if a storefront does not support quantity',async()=>{
 const {purchaseMinutePack}=await import('../src/lib/subscriptions');
 await expect(purchaseMinutePack(session,'minutes_60','browser',3)).rejects.toThrow('Apple app');
 expect(mocks.purchase).not.toHaveBeenCalled();
});
