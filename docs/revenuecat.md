# RevenueCat subscriptions: Audeeo web and iOS

Audeeo keeps its React/Tauri interface. Browser checkout uses `@revenuecat/purchases-js` 1.60.1; Apple apps use the existing Swift bridge with RevenueCat 5.89.0. iOS also links RevenueCatUI for native Paywalls and Customer Center. SwiftUI is not required for the app interface.

## 1. Install and configure

```sh
npm install --save @revenuecat/purchases-js
```

The package and npm lockfile are updated. `native/apple/Package.swift` pins the Apple SDK and declares RevenueCatUI for iOS.

The root `.env` uses Audeeo's explicit Vite configuration allowlist (not `VITE_*`):

```dotenv
# Public SDK keys; safe to bundle. This is the supplied Test Store key.
REVENUECAT_WEB_KEY=test_JRuMuWeCPcSorEjxcuSzTrJJkPD
# For Test Store development only, this can use the same test_ key.
# For actual Apple StoreKit sandbox/TestFlight/App Store use the Apple app's appl_ key.
REVENUECAT_APPLE_KEY=appl_REPLACE_WITH_YOUR_APPLE_PUBLIC_KEY
```

Your local configuration uses the supplied Apple public SDK key for Apple purchases and the Test Store key for web development. Replace the web key with its platform-specific public key before launching web billing. Restart Vite after changing keys. Never put a RevenueCat secret key in either public variable. Test Store transactions do not exercise Apple's payment system; passing them is not proof of StoreKit readiness.

References: [Web SDK installation](https://www.revenuecat.com/docs/getting-started/installation/web-sdk), [SDK configuration](https://www.revenuecat.com/docs/getting-started/configuring-sdk), [Test Store](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store).

## 2. Configure products and an offering in RevenueCat

These are dashboard steps; the local implementation does not create products or publish a paywall remotely.

1. Use one RevenueCat project for Audeeo's Apple and web apps. Add the Apple app with bundle ID `com.mattdev727.audeeo` and connect App Store Connect credentials.
2. Create entitlement **`audeeo_pro`**.
3. Create Test Store products for development. For Apple, create auto-renewable subscriptions in App Store Connect, in the same subscription group and at the same service level. Import them into RevenueCat. Configure a web billing provider and its products for live web checkout.
4. Attach both products on every platform to `audeeo_pro`.
5. Create an offering (for example, `default`) and mark it current. Map packages as follows:

| Display name | Product identifier | Standard RevenueCat package | SDK property |
|---|---|---|---|
| Yearly | `yearly` | `$rc_annual` | `annual` |
| Monthly | `monthly` | `$rc_monthly` | `monthly` |

If Apple products already have other identifiers, keep those and map them to the same packages. The code selects packages, not hardcoded store product IDs. Assign your chosen prices, currencies, and billing durations in each billing provider. Prices in the app come from the SDK.

6. Create and publish a RevenueCat Paywall on the current offering. Include the two packages, terms, privacy policy, and appropriate purchase/restore controls. Use native App Store purchase buttons for the iOS offering. Web and native paywall designs can differ.
7. Configure Customer Center for the iOS app in RevenueCat. Availability depends on your RevenueCat plan. On web, Audeeo links to the customer information's `managementURL`; billing emails provide a fallback portal link.

References: [Offerings](https://www.revenuecat.com/docs/offerings/overview), [Paywalls](https://www.revenuecat.com/docs/tools/paywalls), [iOS Customer Center](https://www.revenuecat.com/docs/tools/customer-center/customer-center-integration-ios), [Web customer portal](https://www.revenuecat.com/docs/web/web-billing/customer-portal).

## 3. App implementation

- `src/lib/subscriptions.ts` selects native or browser billing. It configures the web SDK lazily, changes users before account reads, retrieves customer information and offerings, purchases a selected package, presents a RevenueCat paywall, and handles cancellation.
- `src/components/Subscriptions.tsx` is mounted in Account. It displays Pro status, expiry/renewal date and localized prices, supports explicit restoration, and refreshes when the app regains focus. It never automatically triggers an Apple restore sheet on focus.
- `native/apple/Sources/AudeeoNative/Purchases.swift` identifies the Supabase UUID, reads `audeeo_pro`, selects `annual`/`monthly`, purchases/restores through StoreKit, and presents `PaywallViewController` or `CustomerCenterViewController` on the main thread.
- `src/lib/account.ts` correlates native callbacks with unique request IDs. Interactive purchases do not time out while a payment sheet is open. Both sides prevent overlapping billing operations.

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
    const result = await purchases.presentPaywall({ customerEmail: authenticatedUser.email });
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

Client purchase results update display state only. `/v1/purchases/restore` validates the user's access token, fetches authoritative RevenueCat subscriber state, and updates server allowance. Webhooks and session startup also reconcile entitlement state. Failed reconciliation does not grant paid minutes, and the UI tells the customer to retry refresh rather than buy again.

The existing product configuration determines included audio minutes. Yearly billing now resets the same monthly allowance at UTC purchase anniversaries, with month-end clamping; it does not accidentally stretch one month's minutes across a year. Refunds, expiration, transfers, and renewals must be delivered to the authenticated webhook. Choose RevenueCat's restore/transfer policy deliberately for account ownership. Do not store a persistent `isPro` boolean as authorization.

## 6. Build and test iOS

```sh
# Compiles native RevenueCat + RevenueCatUI and produces the static archive/resources.
sh scripts/apple-native-build.sh ios-simulator
sh scripts/apple-native-build.sh ios

# Tauri now builds the native archive automatically if no override is supplied.
npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci
```

`src-tauri/build.rs` uses the actual SDK for iOS instead of the no-SDK fallback. The generated Xcode project's post-build step copies both `RevenueCat_RevenueCat.bundle` and `RevenueCat_RevenueCatUI.bundle` inside the app before signing. If overriding `AUDEEO_NATIVE_ARCHIVE`, keep these bundles in the same directory as that archive, for the matching platform. Preserve the resource-copy phase when regenerating the Tauri iOS project; `project.yml` includes it.

Before App Store submission, replace the Apple Test Store key with the Apple public key, complete App Store Connect subscription metadata, agreements and banking requirements, and verify the following with StoreKit sandbox/TestFlight:

- Monthly and yearly purchases; local prices; transaction cancellation and payment failure.
- Pro access after purchase and after relaunch; restore on another device with the same account.
- Renewal, expiry, billing issue, refund, and cancellation with access retained until expiry.
- Native Paywall close/purchase/restore and Customer Center dismissal/management.
- Sign-out/sign-in to a different account with no previous customer's Pro state shown.
- Server allowance synchronization and monthly resets for yearly subscriptions.
- Resource loading in an installed signed build with the development build folders absent.

The local SDK build and automated tests cannot verify App Store configuration or execute a real StoreKit transaction. That requires the Apple key, configured products, and a sandbox tester. See [Apple sandbox testing](https://www.revenuecat.com/docs/test-and-launch/sandbox/apple-app-store).
