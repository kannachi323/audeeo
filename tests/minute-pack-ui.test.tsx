// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor,fireEvent,act} from '@testing-library/react';
const mocks=vi.hoisted(()=>({buy:vi.fn(),status:vi.fn(),sync:vi.fn(),offers:vi.fn()}));
vi.mock('../src/lib/subscriptions',()=>({minutePackOffers:mocks.offers,purchaseMinutePack:mocks.buy}));
vi.mock('../src/lib/account',()=>({syncSubscriptionUsage:mocks.sync,packPurchaseStatus:mocks.status}));
import {createRef} from 'react';
import {MinutePacks,type MinutePacksHandle} from '../src/components/MinutePacks';
import {config} from '../src/lib/config';
const pendingKey=`audeeo.pending-pack.owner${config.billingEnvironment==='sandbox'?'.sandbox':''}`;
const session={user:{id:'owner'},access_token:'token'} as any;
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mocks.offers.mockResolvedValue([{id:'minutes_60',minutes:60,productID:'audeeo_minutes_60',price:'$3.00',pricesByQuantity:['$3.00','$6.00','$9.00']}]);mocks.sync.mockResolvedValue({purchasedSeconds:3600,purchaseRevision:2,packsEnabled:true});});
afterEach(cleanup);
it('keeps pending checkout locked until its transaction is server-confirmed, even if a balance exists',async()=>{
 localStorage.setItem(pendingKey,JSON.stringify({transactionId:'new',productID:'audeeo_minutes_60',after:1}));
 mocks.status.mockResolvedValue({status:'pending'});
 const ref=createRef<MinutePacksHandle>();
 render(<MinutePacks ref={ref} session={session} platform="macos"/>);
 const buy=await screen.findByRole('button',{name:'60 usage minutes · $3.00'});
 await act(()=>ref.current!.refresh());
 await screen.findByText(/Purchase pending/);expect((buy as HTMLButtonElement).disabled).toBe(true);expect(mocks.buy).not.toHaveBeenCalled();
 mocks.status.mockResolvedValue({status:'confirmed',environment:'PRODUCTION'});
 await act(()=>ref.current!.refresh());
 await screen.findByText('Minutes added.');expect((buy as HTMLButtonElement).disabled).toBe(false);expect(localStorage.getItem(pendingKey)).toBeNull();
});
it('does not report successful minutes after cancellation',async()=>{
 mocks.buy.mockResolvedValue({status:'cancelled'});render(<MinutePacks session={session} platform="macos"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Buy'}));
 await waitFor(()=>expect(mocks.buy).toHaveBeenCalledTimes(1));await waitFor(()=>expect(localStorage.getItem(pendingKey)).toBeNull());
 expect(mocks.status).not.toHaveBeenCalled();expect(screen.queryByText('Minutes added.')).toBeNull();
});
it('does not update a different account from an old synchronization result',async()=>{
 let resolve!:(v:any)=>void;mocks.sync.mockImplementation(()=>new Promise(r=>{resolve=r}));const synced=vi.fn();
 const ref=createRef<MinutePacksHandle>();
 const view=render(<MinutePacks ref={ref} session={session} platform="macos" onSynced={synced}/>);
 act(()=>{void ref.current!.refresh()});
 view.rerender(<MinutePacks session={{user:{id:'other'}} as any} platform="macos" onSynced={synced}/>);
 resolve({purchasedSeconds:600});await Promise.resolve();expect(synced).not.toHaveBeenCalled();
});

it('retains all pack panels and the price error after a successful balance refresh',async()=>{
 mocks.offers.mockRejectedValue(new Error('StoreKit unavailable'));
 const ref=createRef<MinutePacksHandle>();
 render(<MinutePacks ref={ref} session={session} platform="macos"/>);
 await screen.findByText('Prices are unavailable. Retry to load them.');
 for(const minutes of [60,180,600])expect((screen.getByRole('button',{name:`${minutes} usage minutes · Price unavailable`}) as HTMLButtonElement).disabled).toBe(true);
 await act(()=>ref.current!.refresh());
 expect(screen.getByText('Prices are unavailable. Retry to load them.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Retry prices'})).toBeTruthy();
 expect(mocks.buy).not.toHaveBeenCalled();
});
it('retries prices and only enables offers returned by the store',async()=>{
 mocks.offers.mockResolvedValueOnce([]);
 render(<MinutePacks session={session} platform="macos"/>);
 await screen.findByText('Prices are unavailable. Retry to load them.');
 fireEvent.click(screen.getByRole('button',{name:'Retry prices'}));
 const available=await screen.findByRole('button',{name:'60 usage minutes · $3.00'});
 expect((available as HTMLButtonElement).disabled).toBe(false);
 expect((screen.getByRole('button',{name:'180 usage minutes · Price unavailable'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText('Some prices are unavailable.')).toBeTruthy();
 expect(mocks.offers).toHaveBeenCalledTimes(2);
});
it('ignores catalog results belonging to the previous account',async()=>{
 let resolve!:(v:unknown)=>void;
 mocks.offers.mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue([]);
 const view=render(<MinutePacks session={session} platform="macos"/>);
 view.rerender(<MinutePacks session={{user:{id:'other'}} as any} platform="macos"/>);
 await screen.findByText('Prices are unavailable. Retry to load them.');
 resolve([{id:'minutes_60',minutes:60,price:'$3.00',productID:'audeeo_minutes_60'}]);
 await Promise.resolve();
 expect(screen.queryByRole('button',{name:'60 usage minutes · $3.00'})).toBeNull();
});

it('selects quantity without charging and sends one checkout with the total quantity',async()=>{
 mocks.buy.mockResolvedValue({status:'cancelled'});
 render(<MinutePacks session={session} platform="macos"/>);
 const plus=await screen.findByRole('button',{name:'Increase quantity'});
 fireEvent.click(plus);fireEvent.click(plus);
 expect(mocks.buy).not.toHaveBeenCalled();
 expect(screen.getByLabelText('Total price').textContent).toBe('$9.00');
 expect((plus as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Buy'}));
 await waitFor(()=>expect(mocks.buy).toHaveBeenCalledWith(session,'minutes_60','macos',3));
 expect(screen.queryByText('Usage rates')).toBeNull();
 expect(screen.queryByRole('button',{name:'Refresh balance'})).toBeNull();
});
it('waits for the complete quantity before reporting purchase confirmation',async()=>{
 localStorage.setItem(pendingKey,JSON.stringify({transactionId:'bulk',productID:'audeeo_minutes_60',after:1,quantity:3}));
 mocks.status.mockResolvedValue({status:'confirmed'});
 const ref=createRef<MinutePacksHandle>();
 render(<MinutePacks ref={ref} session={session} platform="macos"/>);
 await act(()=>ref.current!.refresh());
 await screen.findByText('Minutes added.');
 expect(mocks.status).toHaveBeenCalledWith(session,'bulk','audeeo_minutes_60',1,3);
});

it('lets a user dismiss cancelled checkout only after reconciling and only without a completed transaction',async()=>{
 localStorage.setItem(pendingKey,JSON.stringify({transactionId:'',productID:'audeeo_minutes_60',after:1,quantity:2}));
 mocks.status.mockResolvedValue({status:'pending'});
 render(<MinutePacks session={session} platform="macos"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Dismiss cancelled checkout'}));
 await waitFor(()=>expect(localStorage.getItem(pendingKey)).toBeNull());
 expect(mocks.sync).toHaveBeenCalledTimes(1);expect(mocks.buy).not.toHaveBeenCalled();
});
it('does not allow dismissing a checkout with a completed transaction',async()=>{
 localStorage.setItem(pendingKey,JSON.stringify({transactionId:'paid',productID:'audeeo_minutes_60',after:1,quantity:2}));
 render(<MinutePacks session={session} platform="macos"/>);
 await screen.findByRole('button',{name:'Buy'});
 expect(screen.queryByRole('button',{name:'Check purchase'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Dismiss cancelled checkout'})).toBeNull();
});
