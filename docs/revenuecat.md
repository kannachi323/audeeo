> Current minute-pack implementation and rollout: [minute-packs.md](minute-packs.md). Pro includes 600 **usage** minutes monthly; optional speech uses 3×.

# RevenueCat subscriptions: Audeeo web and Apple

The approved launch prices are **$8 USD monthly** and **$80 USD yearly**. Both products grant the same `audeeo_pro` entitlement; yearly billing renews the monthly usage allowance at purchase anniversaries.

Audeeo keeps its React/Tauri interface. Browser checkout uses `@revenuecat/purchases-js` 1.60.1; Mac App Store builds use the Swift bridge with RevenueCat 5.89.0.

## 1. Install and configure

```sh
npm install --save @revenuecat/purchases-js
```

The package and npm lockfile are updated. `native/apple/Package.swift` pins the macOS-compatible RevenueCat SDK.

The root `.env` uses Audeeo's explicit Vite configuration allowlist (not `VITE_*`):

```dotenv
# Public SDK keys; safe to bundle. Use the RevenueCat Billing `rcb_` key in production.
REVENUECAT_WEB_KEY=rcb_REPLACE_WITH_YOUR_PUBLIC_WEB_KEY
# Real web checkout testing uses the separate RevenueCat Billing sandbox key.
REVENUECAT_WEB_SANDBOX_KEY=rcb_sb_REPLACE_WITH_YOUR_SANDBOX_KEY
AUDEEO_DISTRIBUTION=app-store
AUDEEO_BILLING_ENVIRONMENT=sandbox
# For actual Apple StoreKit sandbox/TestFlight/App Store use the Apple app's appl_ key.
REVENUECAT_APPLE_KEY=appl_REPLACE_WITH_YOUR_APPLE_PUBLIC_KEY
```

Production web configuration must use the Audeeo RevenueCat Billing public key (`rcb_`). Use the Test Store key only for isolated development; a configured live catalog does not change the key embedded in an existing build. Restart Vite after changing keys. Never put a RevenueCat secret key in either public variable. Test Store transactions do not exercise Apple's payment system; passing them is not proof of StoreKit readiness.

References: [Web SDK installation](https://www.revenuecat.com/docs/getting-started/installation/web-sdk), [SDK configuration](https://www.revenuecat.com/docs/getting-started/configuring-sdk), [Test Store](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store).

## 2. Configure products and an offering in RevenueCat

RevenueCat Billing is connected to the Audeeo live Stripe account. On September 15, 2026, the `default` offering was verified and updated to include Apple, web, and Test Store products. The existing web prices were verified as $8/month and $80/year. All six products grant `audeeo_pro`.

Both Apple credential connections are now valid. The existing App Store monthly subscription is `AUDEEO_MONTHLY_1` (Apple ID `6811513313`); it was imported into RevenueCat and replaces the unused `audeeo_pro_monthly` draft. That draft is inactive and is no longer in the offering. The annual product `audeeo_pro_yearly` (Apple ID `6812601915`) was created in App Store Connect. Both belong to subscription group `22380999` (`Audeeo Pro`) at service level 1 and grant the same entitlement.

Apple prices were saved and read back through App Store Connect: exactly $8 USD monthly and $80 USD yearly, with Apple's equivalent local prices and availability verified in all 175 storefronts for both products. The old monthly $14.99 USD price was replaced. No purchase was executed.

English subscription/group metadata and review notes are configured. Both Apple subscriptions still require a real purchase-screen screenshot for App Review and submission with the first app version. They have not been approved or tested with a StoreKit purchase. Catalog configuration alone does not establish release readiness.

1. Use one RevenueCat project for Audeeo's Apple and web apps. Add the Apple app with bundle ID `com.mattdev727.audeeo` and connect App Store Connect credentials.
2. Create entitlement **`audeeo_pro`**.
3. Create Test Store products for development. For Apple, create auto-renewable subscriptions in App Store Connect, in the same subscription group and at the same service level. Import them into RevenueCat. Configure a web billing provider and its products for live web checkout.
4. Attach both products on every platform to `audeeo_pro`.
5. Create an offering (for example, `default`) and mark it current. Map packages as follows:

| Display name | Product identifier | Standard RevenueCat package | SDK property |
|---|---|---|---|
| Yearly | `audeeo_pro_yearly` (Apple) / `audeeo_pro_yearly_web` (web) / `yearly` (Test Store) | `$rc_annual` | `annual` |
| Monthly | `AUDEEO_MONTHLY_1` (Apple) / `audeeo_pro_monthly_web` (web) / `monthly` (Test Store) | `$rc_monthly` | `monthly` |

If Apple products already have other identifiers, keep those and map them to the same packages. The code selects packages, not hardcoded store product IDs. Assign your chosen prices, currencies, and billing durations in each billing provider. Prices in the app come from the SDK.

6. Verify the current offering contains both subscription packages, localized prices, terms, privacy policy, and purchase/restore controls.
7. On web, Audeeo links to the customer information’s `managementURL`; billing emails provide a fallback portal link.

References: [Offerings](https://www.revenuecat.com/docs/offerings/overview), [Paywalls](https://www.revenuecat.com/docs/tools/paywalls), [Web customer portal](https://www.revenuecat.com/docs/web/web-billing/customer-portal).

## 3. App implementation

- `src/lib/subscriptions.ts` selects native or browser billing. It configures the web SDK lazily, changes users before account reads, retrieves customer information and offerings, purchases a selected package, presents a RevenueCat paywall, and handles cancellation.
- `src/components/Subscriptions.tsx` is mounted in Account. It displays Pro status, expiry/renewal date and localized prices, supports explicit restoration, and refreshes when the app regains focus. It never automatically triggers an Apple restore sheet on focus.
- `native/apple/Sources/AudeeoNative/Purchases.swift` identifies the Supabase UUID, reads `audeeo_pro`, selects `annual`/`monthly`, purchases/restores through StoreKit, and presents `PaywallViewController` or `CustomerCenterViewController` on the main thread.
- `src/lib/account.ts` correlates native callbacks with unique request IDs. Interactive purchases do not time out while a payment sheet is open. Both sides prevent overlapping billing operations.
- `website/src/pages/Pricing.tsx` offers direct monthly and yearly web checkout after sign-in. It uses the same Supabase UUID as the app, then asks the authenticated relay to reconcile the purchased entitlement into Audeeo's server-enforced allowance.

The shared customer ID is `session.user.id`, matching the authenticated server and native SDK. Do not use email addresses, a hardcoded ID, or a newly generated ID per launch. Signing in to the same account on another device retrieves its RevenueCat entitlements. Web does not use a native `restorePurchases()` method.

`entitlements.active.audeeo_pro` determines Pro access. A cancelled auto-renewal can still have an active entitlement until expiry; `willRenew` is informational. A completed purchase or successful restore alone does not imply entitlement access.

## 4. Complete JavaScript web example

This framework-free example uses the same modern SDK methods as the React implementation. Call `mountSubscriptions` only after your authentication provider has resolved the signed-in user. Dispose the view before switching accounts; finish an active checkout before switching users.

```html
<section id="subscriptions">
  <p data-status role="status"></p>
  <div data-plans></div>
  <button data-paywall>View subscription options</button>
  <button data-refresh>Refresh purchases</button>
  <a data-manage hidden target="_blank" rel="noopener noreferrer">Manage subscription</a>
</section>
```

```js
import { Purchases, PurchasesError, ErrorCode } from '@revenuecat/purchases-js';

let purchases;
export async function mountSubscriptions(root, authenticatedUser) {
  if (!authenticatedUser?.id) throw new Error('Sign in first.');
  if (!purchases) {
    purchases = Purchases.configure({
      apiKey: 'test_JRuMuWeCPcSorEjxcuSzTrJJkPD',
      appUserId: authenticatedUser.id,
    });
  } else {
    await purchases.changeUser(authenticatedUser.id);
  }
  const status = root.querySelector('[data-status]');
  const plans = root.querySelector('[data-plans]');
  const manage = root.querySelector('[data-manage]');
  const abort = new AbortController();
  let busy = false;
  let active = false;
  function showCustomer(info) {
    active = Object.hasOwn(info.entitlements.active, 'audeeo_pro');
    status.textContent = active ? 'Audeeo Pro is active.' : 'Free plan';
    manage.hidden = true;
    if (info.managementURL) {
      const url = new URL(info.managementURL);
      if (url.protocol === 'https:') {
        manage.href = url.href;
        manage.hidden = false;
      }
    }
  }
  async function run(operation) {
    if (busy || abort.signal.aborted) return;
    busy = true;
    root.querySelectorAll('button').forEach(button => button.disabled = true);
    try {
      const info = await operation();
      if (!abort.signal.aborted && info) showCustomer(info);
    } catch (error) {
      if (!(error instanceof PurchasesError && error.errorCode === ErrorCode.UserCancelledError)) {
        status.textContent = 'Subscription request failed. Please retry.';
      }
    } finally {
      busy = false;
      root.querySelectorAll('button').forEach(button => {
        button.disabled = active && !button.matches('[data-refresh]');
      });
    }
  }
  root.querySelector('[data-refresh]').addEventListener('click', () =>
    run(() => purchases.getCustomerInfo()), { signal: abort.signal });
  root.querySelector('[data-paywall]').addEventListener('click', () => run(async () => {
    const result = await purchases.presentPaywall({ htmlTarget: root, customerEmail: authenticatedUser.email });
    return result.customerInfo;
  }), { signal: abort.signal });
  await run(async () => {
    const info = await purchases.getCustomerInfo();
    showCustomer(info);
    const offering = (await purchases.getOfferings()).current;
    plans.replaceChildren();
    for (const [label, pkg] of [['Yearly', offering?.annual], ['Monthly', offering?.monthly]]) {
      if (!pkg) continue;
      const button = document.createElement('button');
      button.textContent = `${label}: ${pkg.webBillingProduct.currentPrice.formattedPrice}`;
      button.addEventListener('click', () => run(async () => {
        const result = await purchases.purchase({
          rcPackage: pkg, customerEmail: authenticatedUser.email,
        });
        return result.customerInfo;
      }), { signal: abort.signal });
      plans.append(button);
    }
    return info;
  });
  return () => abort.abort();
}
```

For Audeeo, use the integrated component instead of mounting this separate example. Its purchase/restore completion additionally calls the authenticated relay to reconcile allowance. The browser SDK's [current web guide](https://www.revenuecat.com/docs/web/web-billing/web-sdk) documents `purchase`, `getCustomerInfo`, and `presentPaywall`.

## 5. Server entitlement and subscription management

Set the relay's secret `REVENUECAT_SECRET_KEY` to the same project's server API key and configure authenticated webhooks at `https://YOUR_RELAY/v1/billing/webhook` using `REVENUECAT_WEBHOOK_AUTH_KEY`. The checked-in relay binding now uses `REVENUECAT_ENTITLEMENT=audeeo_pro`; deploy that configuration when deploying the relay. Configure allowed origins for your deployed web app.

Client purchase results update display state only. `/v1/purchases/restore` validates the user's access token, fetches authoritative RevenueCat subscriber state, and atomically updates allowance counters and verified subscription identity in a server-only `billing_accounts` row. A paid allowance is accepted only when the entitlement maps to a concrete RevenueCat product and store transaction/subscription identifier. The account records the RevenueCat customer ID, subscription ID, entitlement, product, store, period, and last verification time; RLS and grants keep it inaccessible to end-user JWTs.

The restore response and authenticated `GET /v1/account/usage` return a server-derived usage snapshot from `billing_accounts`: used, included, and remaining seconds for the active paid or lifetime-free allowance. The app and website render that snapshot rather than calculating usage from RevenueCat or local session history. Webhooks and session startup also reconcile entitlement state. Failed reconciliation does not grant paid minutes, and the UI tells the customer to retry refresh rather than buy again.

The existing product configuration determines included audio minutes. Yearly billing now resets the same monthly allowance at UTC purchase anniversaries, with month-end clamping; it does not accidentally stretch one month's minutes across a year. Refunds, expiration, transfers, and renewals must be delivered to the authenticated webhook. Choose RevenueCat's restore/transfer policy deliberately for account ownership. Do not store a persistent `isPro` boolean as authorization.

## 6. Build and test macOS

```sh
sh scripts/apple-native-build.sh macos
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
```

Tauri builds the native SDK automatically. Release packaging must include the
RevenueCat resources and privacy manifest before signing; see
[Mac App Store packaging](mac-app-store.md).

Verify monthly/yearly purchases, localized prices, cancellation, restoration,
renewal/expiry, account switching, and server allowance synchronization in a
signed build with an Apple sandbox tester. Test installed resource loading with
the development build folders absent. Local compilation does not verify StoreKit
transactions or App Store configuration.
