// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({
  info: vi.fn(), plans: vi.fn(), action: vi.fn(), reconcile: vi.fn(), native: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.native }));
vi.mock("../src/lib/account", () => ({ syncSubscriptionUsage: mocks.reconcile }));
vi.mock("../src/lib/subscriptions", () => ({
  nativeBilling:()=>false,minutePackOffers:vi.fn().mockResolvedValue([]),purchaseMinutePack:vi.fn(),
  customerInfo: mocks.info, subscriptionPlans: mocks.plans,
  subscriptionAction: mocks.action, subscriptionManagementURL: () => null,
}));
import { Subscriptions } from "../src/components/Subscriptions";
const session = { user: { id: "owner" }, access_token: "test" } as any;
beforeEach(() => {
  vi.clearAllMocks(); mocks.native.mockReturnValue(false);
  mocks.info.mockResolvedValue({ active: false });
  mocks.plans.mockResolvedValue([{ id: "yearly", price: "$99.00", productID: "yearly" }]);
  mocks.reconcile.mockResolvedValue({ active: false, unlimited: false, usedSeconds: 60, includedSeconds: 300, remainingSeconds: 240 });
});
it("shows the server-authoritative usage counter", async () => {
  render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={() => {}} />);
  expect(await screen.findByLabelText("4 min remaining")).toBeTruthy();
});
it("shows active unlimited access without loading purchase options or unrelated store errors", async () => {
  mocks.info.mockResolvedValue({ active: true, expiresAt: "2027-09-15T20:01:52Z", productID: "rc_promo_audeeo_pro_custom", willRenew: false });
  mocks.reconcile.mockResolvedValue({ active: true, unlimited: true, usedSeconds: 588 });
  mocks.plans.mockRejectedValue(new Error("RevenueCat offerings unavailable"));
  render(<Subscriptions session={session} platform="macos" disabled={false} onBusy={() => {}} />);
  expect(await screen.findByRole("heading",{name:"Audeeo Pro"})).toBeTruthy();
  expect(screen.getByText("Unlimited")).toBeTruthy();
  expect(screen.queryByRole("progressbar",{name:"Plan usage"})).toBeNull();
  expect(screen.getByText("Complimentary access")).toBeTruthy();
  expect(screen.getByLabelText("9.8 min used")).toBeTruthy();
  expect(screen.getByText("Access until")).toBeTruthy();
  expect(mocks.plans).not.toHaveBeenCalled();
  expect(screen.queryByText(/RevenueCat offerings unavailable/)).toBeNull();
  expect(screen.queryByText("Billing help")).toBeNull();
});
afterEach(cleanup);
it("retains purchased entitlement and directs refresh when server reconciliation fails", async () => {
  render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={() => {}} />);
  const yearly = await screen.findByRole("button", { name: "Yearly · $99.00 / year" });
  await waitFor(() => expect((yearly as HTMLButtonElement).disabled).toBe(false));
  mocks.action.mockResolvedValue({ active: true });
  mocks.reconcile.mockRejectedValue(new Error("offline"));
  await userEvent.click(yearly);
  expect(await screen.findByRole("heading",{name:"Audeeo Pro"})).toBeTruthy();
  expect(await screen.findByText(/do not purchase again/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Yearly · $99.00 / year" })).toBeNull();
});
it("refreshes native customer information on focus without triggering restorePurchases", async () => {
  mocks.native.mockReturnValue(true);
  render(<Subscriptions session={session} platform="macos" disabled={false} onBusy={() => {}} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalledTimes(1));
  fireEvent.focus(window);
  expect(mocks.info).toHaveBeenCalledTimes(1);
  const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+31000);
  fireEvent.focus(window);
  await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(2));
  clock.mockRestore();
  expect(mocks.action).not.toHaveBeenCalled();
});
it("does not display a late result after account view disposal", async () => {
  let resolve!: (result: unknown) => void;
  mocks.info.mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={() => {}} />);
  view.unmount(); resolve({ active: true });
  await Promise.resolve();
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("shows the paid price rather than the current catalog price",async()=>{
  mocks.info.mockResolvedValue({active:true,productID:'yearly',paidPrice:'$79.00',periodType:'normal'});
  mocks.reconcile.mockResolvedValue({active:true,unlimited:false,usedSeconds:0,includedSeconds:600,remainingSeconds:600});
  render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
  expect(await screen.findByText('$79.00 / year')).toBeTruthy();
  expect(screen.queryByText(/\$99.00/)).toBeNull();
});
it("edits the daily reminder in a modal without calling billing or saving from the panel",async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const change=vi.fn(),user=userEvent.setup();
  render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}} dailyBudget={{day:'2026-09-15',minutes:60,usedSeconds:2700,notifiedMinutes:null}} onDailyBudgetChange={change}/>);
  await screen.findByLabelText('4 min remaining');
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByRole('button',{name:'Save'})).toBeNull();
  await user.click(screen.getByRole('button',{name:'Adjust daily reminder'}));
  const field=screen.getByRole('spinbutton',{name:'Daily budget'});
  await user.clear(field);await user.type(field,'90');
  await user.click(screen.getByRole('button',{name:'Apply'}));
  expect(change).toHaveBeenCalledWith(90);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.action).not.toHaveBeenCalled();
});
it('does not label an introductory payment as the normal renewal price',async()=>{
  mocks.info.mockResolvedValue({active:true,productID:'yearly',paidPrice:'$1.00',periodType:'intro'});
  mocks.reconcile.mockResolvedValue({active:true,unlimited:true,usedSeconds:0});
  render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
  expect(await screen.findByText('Introductory payment')).toBeTruthy();
  await waitFor(()=>expect(mocks.plans).toHaveBeenCalled());
  expect(screen.getByText('$1.00')).toBeTruthy();
  expect(screen.queryByText('$1.00 / year')).toBeNull();
});

it('shows skeletons while loading instead of a zero balance or free plan',async()=>{
 let resolve!:(value:unknown)=>void;
 mocks.info.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 expect(screen.getByRole('status',{name:'Loading subscription…'})).toBeTruthy();
 expect(screen.getByRole('status',{name:'Loading usage…'})).toBeTruthy();
 expect(screen.queryByLabelText('0 min remaining')).toBeNull();
 expect(screen.queryByText('Free plan')).toBeNull();
 resolve({active:false});
 expect(await screen.findByLabelText('4 min remaining')).toBeTruthy();
 await waitFor(()=>expect(screen.queryByRole('status',{name:'Loading subscription…'})).toBeNull());
});
it('keeps the existing allowance visible during a refresh',async()=>{
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 await screen.findByLabelText('4 min remaining');
 const refresh=screen.getByRole('button',{name:'Refresh purchases'});
 await waitFor(()=>expect((refresh as HTMLButtonElement).disabled).toBe(false));
 let resolve!:(value:unknown)=>void;
 mocks.reconcile.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 mocks.action.mockResolvedValue({active:false});
 fireEvent.click(refresh);
 await waitFor(()=>expect(mocks.reconcile).toHaveBeenCalledTimes(2));
 expect(screen.getByLabelText('4 min remaining')).toBeTruthy();
 expect(screen.queryByRole('status',{name:'Loading usage…'})).toBeNull();
 resolve({active:false,unlimited:false,usedSeconds:120,includedSeconds:300,remainingSeconds:180});
 expect(await screen.findByLabelText('3 min remaining')).toBeTruthy();
});
it('includes purchased minutes when there is no plan allowance',async()=>{
 mocks.reconcile.mockResolvedValue({active:false,unlimited:false,usedSeconds:0,includedSeconds:0,remainingSeconds:0,purchasedSeconds:3600});
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 await screen.findByLabelText('60 min remaining');
 expect(screen.queryByRole('progressbar',{name:'Plan usage'})).toBeNull();
 expect(screen.queryByText('Balance details')).toBeNull();
});

it('shows the lifetime free allowance without a monthly reset date',async()=>{
 mocks.reconcile.mockResolvedValue({active:false,unlimited:false,usedSeconds:0,includedSeconds:1800,remainingSeconds:1800,purchasedSeconds:0,periodEnd:'2026-09-01T00:00:00Z'});
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByLabelText('30 min remaining')).toBeTruthy();
 expect(screen.queryByText(/Resets/)).toBeNull();
});
it('keeps the whole subscription card loading until reconciliation finishes',async()=>{
 mocks.info.mockResolvedValue({active:true,paidPrice:'$8.00'});
 let resolve!:(value:unknown)=>void;
 mocks.reconcile.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 await waitFor(()=>expect(mocks.reconcile).toHaveBeenCalled());
 expect(screen.getByRole('status',{name:'Loading subscription…'}).closest('.subscription-settings')).toBeTruthy();
 expect(screen.queryByText('$8.00')).toBeNull();
 resolve({active:true,unlimited:false,usedSeconds:0,includedSeconds:36000,remainingSeconds:36000});
 expect(await screen.findByText('$8.00')).toBeTruthy();
 expect(screen.queryByRole('status',{name:'Loading subscription…'})).toBeNull();
});

it('does not misreport store catalog failures as a missing billing SDK',async()=>{
 mocks.info.mockRejectedValue(new Error('RevenueCat.OfferingsManager.Error error 1'));
 render(<Subscriptions session={session} platform="macos" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByText('The store couldn’t load subscription details. Refresh purchases to retry.')).toBeTruthy();
 expect(screen.queryByText('Purchases are unavailable in this version.')).toBeNull();
});

it('shows billing cadence instead of an accelerated test expiration as the renewal date',async()=>{
 const expiresAt='2026-09-16T19:23:00Z';
 mocks.info.mockResolvedValue({active:true,productID:'audeeo_pro_yearly',paidPrice:'$80.00',expiresAt,willRenew:true});
 mocks.plans.mockRejectedValue(new Error('StoreKit unavailable'));
 mocks.reconcile.mockResolvedValue({active:true,unlimited:false,usedSeconds:120,remainingSeconds:35880,includedSeconds:36000,purchasedSeconds:0,periodEnd:expiresAt,sandbox:{subscriptionActive:true,purchasedSeconds:0,expiresAt,productId:'audeeo_pro_yearly'}});
 render(<Subscriptions session={session} platform="macos" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByRole("heading",{name:"Audeeo Pro"})).toBeTruthy();
 expect(screen.getByRole('heading',{name:'Usage'})).toBeTruthy();
 expect(screen.getByLabelText('598 min remaining')).toBeTruthy();
 expect(screen.getByText('$80.00 / year')).toBeTruthy();
 expect(screen.getByText('Billing cycle')).toBeTruthy();
 expect(screen.getByText('Yearly')).toBeTruthy();
 expect(screen.queryByText('Renews')).toBeNull();
 expect(screen.queryByText('Live usage')).toBeNull();
 expect(screen.queryByText('Free allowance')).toBeNull();
});

it.each([false,true])('includes the remaining pack balance in the headline (sandbox: %s)',async sandbox=>{
 mocks.reconcile.mockResolvedValue({active:true,unlimited:false,usedSeconds:6000,includedSeconds:36000,remainingSeconds:30000,purchasedSeconds:3600,totalRemainingSeconds:33600,...(sandbox?{sandbox:{subscriptionActive:true,purchasedSeconds:3600}}:{})});
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByLabelText('560 min remaining')).toBeTruthy();
 expect(screen.queryByText('Balance details')).toBeNull();
 expect(screen.getByText('Plan minutes').closest('details')).toBeNull();
 expect(screen.getByText('Plan minutes').parentElement?.textContent).toContain('500');
 expect(screen.getByText('Purchased minutes').parentElement?.textContent).toContain('60');
});
it('still shows pack minutes when the plan is exhausted',async()=>{
 mocks.reconcile.mockResolvedValue({active:true,unlimited:false,usedSeconds:36000,includedSeconds:36000,remainingSeconds:0,purchasedSeconds:10800,totalRemainingSeconds:10800});
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByLabelText('180 min remaining')).toBeTruthy();
});

it('refreshes the balance from Usage without reloading the subscription',async()=>{
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 await screen.findByLabelText('4 min remaining');
 await waitFor(()=>expect((screen.getByRole('button',{name:'Refresh'}) as HTMLButtonElement).disabled).toBe(false));
 mocks.reconcile.mockResolvedValue({active:false,includedSeconds:1800,remainingSeconds:1800,purchasedSeconds:3600,totalRemainingSeconds:5400});
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 expect(await screen.findByLabelText('90 min remaining')).toBeTruthy();
 expect(mocks.info).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'Refresh'}).closest('section')?.getAttribute('aria-label')).toBe('Usage');
});
it('still loads a free wallet when the subscription store is unavailable',async()=>{
 mocks.info.mockRejectedValue(new Error('Store unavailable'));
 mocks.reconcile.mockResolvedValue({active:false,includedSeconds:1800,remainingSeconds:1800,purchasedSeconds:3600,totalRemainingSeconds:5400});
 render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByLabelText('90 min remaining')).toBeTruthy();
 expect(screen.getByText('Free plan')).toBeTruthy();
});

it('retains the actual annual renewal date for production subscriptions',async()=>{
 mocks.info.mockResolvedValue({active:true,productID:'audeeo_pro_yearly',paidPrice:'$80.00',expiresAt:'2027-09-16T19:23:00Z',willRenew:true});
 mocks.reconcile.mockResolvedValue({active:true,remainingSeconds:36000,includedSeconds:36000});
 render(<Subscriptions session={session} platform="macos" disabled={false} onBusy={()=>{}}/>);
 expect(await screen.findByText('Renews')).toBeTruthy();
 expect(screen.getByText(new Date('2027-09-16T19:23:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}))).toBeTruthy();
});
