# Subscriptions, minute packs, and spoken translation

## Product rules

Free accounts receive 1,800 usage seconds (30 minutes) once per account. This lifetime allowance does not renew monthly or reset after subscribing, canceling, or restoring purchases. Existing free usage is deducted, and the same 1× captions / 3× spoken translation rates apply. The `grant_thirty_free_minutes` migration sets the server-owned `billing_settings.free_seconds` limit.

Pro costs $8/month or $80/year and includes 36,000 usage seconds (600 minutes) each monthly anniversary, without rollover. The server owns allowance and wallet balances. The account headline adds remaining plan/free seconds and unspent pack seconds; the plan/pack breakdown remains visible below the total. Spent or refunded pack minutes are not counted again. Packs are repeatable, never expire, survive subscription cancellation, and do not grant the Pro entitlement.

| Package | Apple product | Web product | Seconds | USD |
| --- | --- | --- | ---: | ---: |
| minutes_60 | audeeo_minutes_60 | audeeo_minutes_60_web | 3,600 | $3 |
| minutes_180 | audeeo_minutes_180 | audeeo_minutes_180_web | 10,800 | $8 |
| minutes_600 | audeeo_minutes_600 | audeeo_minutes_600_web | 36,000 | $20 |

The separate RevenueCat `minute_packs` offering (`ofrng745623b40d`) maps each package to its Apple and web products. No pack has an entitlement. Display prices come from the SDK, not this table.

Captions and translated text consume one usage second per active second. Spoken translation consumes three. Thus 600 usage minutes provide 600 caption minutes, 200 spoken minutes, or a mix. The UI discloses this before purchase and beside the voice toggle. Voice starts off. Switching it settles the previous rate and reserves at the new rate before acknowledging the change. Fractional seconds carry across rate changes; stopping rounds down the final fraction.

Subscription allowance is spent first. Pack spending requires explicit approval for the current session, including pack-only sessions. When allowance ends, the relay closes provider processing, discards speech, and tells clients to pause capture before requesting approval. Paused time, connection setup and waiting for the first capture packet are not charged.

## Financial storage

Migrations `20260916055243_minute_packs_and_weighted_usage.sql` and `20260916063748_wallet_refund_audit.sql` are additive and deployed. `billing_settings.monthly_seconds` is 36,000.

- `minute_pack_products`: service-owned grant sizes and identifiers. The `enabled` column is reserved for catalog administration; checkout activation currently uses the relay's `MINUTE_PACKS_ENABLED` flag.
- `minute_pack_purchases`: immutable owner/store/environment/transaction identity, grant, remaining seconds, refund status and repeat-refund review flag. A unique transaction constraint prevents duplicate credit.
- `minute_credit_ledger`: append-only purchase/reserve/release/refund entries. Never mutate it from a client. Refunds remove unused minutes and absorb spent minutes; refunded reservations cannot recreate a balance.
- `metered_usage_leases`: weighted reservations, rates, checkpoints, allocations and final charges. Leases are at most 15 active seconds, with a prefetched next lease. The relay checkpoints every five active seconds and the scheduled worker reconciles expired leases every minute. After a crash, only the last durable server checkpoint is charged; uncheckpointed time is absorbed.

All wallet mutation functions and tables require the backend service role. Owners serialize reservations through a billing-account row lock. Purchased grants are consumed oldest first. Sandbox transactions remain in a separate environment and cannot fund production sessions. History retention and deletion do not reference financial tables. Account deletion remains a separate account-wide lifecycle operation.

RevenueCat webhook event IDs and store transaction IDs are independently deduplicated. Apple `mac_app_store` and `app_store` names normalize to one store. Aliases never multiply grants; refunds find the original wallet owner even if the RevenueCat customer was transferred. Refund-first events create a tombstone so a later purchase event cannot resurrect credits.

## Purchase delivery and recovery

The authenticated `POST /v1/purchases/restore` synchronizes subscriptions and one-time purchases. `GET /v1/purchases/status` reports an owned transaction's confirmation/refund status. Clients persist an account-scoped pending checkout and offer synchronization without another purchase. SDK success alone does not grant minutes.

The relay uses the existing RevenueCat v1 key for entitlement verification and a separate **read-only v2** key for purchase recovery. The v2 key has only Purchases Configuration and Products Configuration read permissions. It is installed as `REVENUECAT_V2_SECRET_KEY`; the project is `696fbac4`. The webhook `audeeo-billing` targets `https://api.audeeo.app/v1/billing/webhook` and covers all apps, all event types, and both environments, including consumable refund cancellations.

Public client keys are explicitly allowlisted at build time. The production web key is the RevenueCat Billing `rcb_` key. `AUDEEO_DISTRIBUTION=app-store` selects native Apple billing on macOS; `direct` selects authenticated browser checkout. Both channels use the signed-in Supabase UUID. Balance recovery is account synchronization, independent of StoreKit restore.

## Speech and retired BYOK

`liveSession.ts` always uses server-owned Soniox credentials and `stt-rt-v5`. `SonioxVoice` queues committed translation utterances once in order through `tts-rt-v2`, Daniel, PCM16 at 24 kHz. Turning voice off cancels upstream generation and resets playback. Turning it on speaks only new committed translations. Speech/provider/playback failures fall back to captions and 1× metering with a retryable notice. Language/device capability checks disable unsupported combinations.

Traditional and Simplified Chinese display handling remains separate. Chinese speech text is converted to the script supported by TTS without changing captions/history.

Personal-key controls, native parameters and authorization bypasses are removed. The migration clears app-owned provider keys. Existing personal-key setup choices return to setup; verified subscribers and users with purchased balance can continue. Summaries and screen filling use the server OpenAI credential and never debit the minute ledger.

## Deployment and release gates

1. Apply additive migrations before deploying the relay and compatible clients.
2. Deploy the relay with `MINUTE_PACKS_ENABLED=false`. Confirm `/health` and `/v1/release-readiness`; `packRecoveryConfigured` must be true.
3. Set the distribution channel in the root `.env`, then build the app and deploy the web client. The Mac App Store packaging script validates `app-store`; it does not override the setting.
4. Qualify sandbox purchases, cancellation, pending payment, recovery after restart, duplicate/out-of-order deliveries, refunds after spending, and the signed native purchase sheet.
5. Submit the first Apple consumables with the app version. Only enable `MINUTE_PACKS_ENABLED=true` after the release gates pass. Roll back checkout by restoring false; keep verification/refunds/reconciliation running.

Apple consumables: 60 minutes `6812638075`, 180 `6812638150`, 600 `6812638153`. USD prices, localized price schedules, 175 storefronts, English metadata and review-screen images are configured. The review images use the production purchase component and verified catalog values; they are draft review material, not evidence of a completed StoreKit purchase. All three products read back as `READY_TO_SUBMIT`. No App Review submission or approval is implied.

## Verification and monitoring

The application suite covers exact 60/180/120-second examples, rate switching, fractional carry, deferred connection startup, voice failure/cancellation/order, pending purchases, owner changes, recovery, and removed personal keys. The database integration suite exercises concurrent reservations, consent, partial grants, unused refunds, held-reservation refunds, refund-before-purchase, environment/owner isolation, RLS and history lifecycle preservation.

Operational events contain no audio/transcript/key data: `usage_settled` (rate, active seconds, usage seconds, released seconds), `pack_reconciled` (product, store, environment, refund flag), `usage_leases_reconciled` (count). Cloudflare observability is enabled. RevenueCat delivery failures must be retried and reviewed; do not count reconciliation events as unique purchases.

Service-only diagnostic queries:

```sql
-- Backlog should clear shortly after expiry; investigate persistent growth.
select count(*), min(expires_at) from public.metered_usage_leases
where settled_at is null and expires_at < now();
-- Compare paid usage and active seconds by voice mode and environment.
select environment, rate, sum(charged_seconds) usage_seconds,
       sum(charged_seconds::numeric / rate) active_seconds
from public.metered_usage_leases where settled_at >= now() - interval '1 day'
group by environment, rate;
-- Review repeat refund behavior without automatically charging spent minutes back.
select id, owner_id, store, environment, product_id, refunded_at
from public.minute_pack_purchases where refund_review;
-- Ledger arithmetic must match the remaining wallet for every grant.
select p.id from public.minute_pack_purchases p
join public.minute_credit_ledger l on l.purchase_id=p.id
group by p.id having sum(l.seconds) <> p.remaining_seconds;
```


References: [RevenueCat consumables](https://www.revenuecat.com/docs/platform-resources/non-subscriptions), [purchase API](https://www.revenuecat.com/docs/api-v2/purchase), [Soniox speech pipeline](https://soniox.com/docs/translation/sts-translation).

### September 16, 2026 sandbox verification

A real RevenueCat Billing sandbox checkout using Stripe's test card completed for the 60-minute pack. The authenticated relay confirmed the transaction as `SANDBOX`, granted exactly 3,600 sandbox seconds, and returned zero production seconds with Pro inactive. Two additional synchronization attempts preserved a single grant. A service-side sandbox reservation consumed 18 usage seconds (six spoken seconds), then a RevenueCat sandbox refund removed exactly the remaining 3,582 seconds. The ledger sums to zero. A production WebSocket session with this account paused before provider capture and refused to spend the sandbox balance even after consent.

Apple's native StoreKit purchase test is separate and requires signing into the isolated signed Mac build and an Apple sandbox tester. The local signed App Store-channel build and direct-channel build both compile. These development-signed artifacts are not notarized release installers.


### Local payment testing

The root `.env` selects the channel and payment environment:

```dotenv
AUDEEO_DISTRIBUTION=app-store
AUDEEO_BILLING_ENVIRONMENT=sandbox
```

Use `app-store` for native StoreKit and `direct` for DMG browser checkout. These are build configuration values read from `.env`; changing a shipped binary requires rebuilding it. The App Store packager scopes billing to production for a normal release or sandbox with `--testflight`, without editing the developer's `.env`.

- `REVENUECAT_APPLE_KEY` stays the Apple `appl_` key. StoreKit decides sandbox versus production from the signed app/receipt, not from the billing-mode setting.
- Web sandbox selects `REVENUECAT_WEB_SANDBOX_KEY` (`rcb_sb_`); production selects `REVENUECAT_WEB_KEY` (`rcb_`). Mismatched keys fail configuration.
- Run `npm --prefix website run dev` and open `http://localhost:5173/pricing`. Sandbox direct builds open this URL. The visible sandbox banner must be present before testing. Use Stripe's test card `4242 4242 4242 4242`, a future expiry, and any valid test CVC/postcode.
- Build the signed Apple silicon test app with `npm run release:mac -- --local --target aarch64-apple-darwin`. Open Account & billing, select a plan or pack, and use an Apple sandbox tester when StoreKit asks. The Google Audeeo login and the Apple sandbox tester are separate accounts.
- `BILLING_TEST_USER_IDS` is a server-only UUID allowlist. It permits sandbox checkout while the public `MINUTE_PACKS_ENABLED` gate is false. It does not provide unlimited usage or free live credits.
- `APP_REVIEW_USER_IDS` is a separate server-only list for dedicated reviewer accounts. These accounts use verified sandbox subscriptions, purchase confirmation, and metering even in the production binary. Never enroll a personal account or a paying customer: production purchases are not the balance used by a review account. The client cannot enroll itself. Ordinary testers still select sandbox explicitly and ordinary customers remain in production.
- Sandbox builds show and spend sandbox allowance and pack balances. Testers receive a separate lifetime free allowance; a verified test subscription grants 600 minutes per allowance period, bounded by the store’s accelerated expiry. Restores preserve consumption, and a new allowance period resets the subscription counter once. These credits cannot fund production sessions. Both HTTP billing queries and WebSocket session starts require the server tester allowlist for sandbox access. Browser and desktop session handshakes select the environment from build configuration. Pack status filters by environment.
- Renewals show the actual store date and time. The annual plan still displays its annual billing cadence; the UI does not invent a future production expiry.
- `sandbox_billing_accounts` holds separate free and subscription counters. Both environments serialize on the owner billing row. Reservations record their environment and allowance period, so old lease settlement cannot credit a new period or the other environment. Only the service role can access the new table and RPCs.
- `npm --prefix website run build:sandbox` writes `website/dist-sandbox`. Ordinary production website builds reject sandbox settings to prevent publishing test checkout accidentally.

Restart development processes after editing `.env`. Set `AUDEEO_BILLING_ENVIRONMENT=production` before a public website or distribution release. Public pack sales remain disabled until native purchase testing and the other release gates above pass.


### Latest payment readiness check

The signed Mac App Store-channel build retrieved all three consumables at the expected localized USD prices. Its 60-minute purchase reached StoreKit sandbox authentication, but Apple reported no active sandbox account and did not present a sign-in sheet. Native purchase completion remains unverified; a sandbox tester must be configured before this gate can pass.

The integrated local web UI completed the $8 monthly sandbox subscription and a 60-minute sandbox pack for the designated test account. The UI reported server-confirmed subscription status and 60 purchased test minutes. The database recorded exactly one 3,600-second sandbox grant; the live account remained inactive, not unlimited, with zero included and purchased seconds. The $80 yearly and $8/$20 pack prices were retrieved from the SDK. The 180-minute checkout was opened but not completed before the Mac locked; these remaining product transactions are not marked passed.

The application suite passed 275 tests, the app and sandbox website built, and relay type checking passed. Backend sandbox access/environment isolation is deployed. No live purchase was made and public pack checkout remains disabled.

### September 16 sandbox allowance fix

Applied `grant_thirty_free_minutes` and `metered_sandbox_allowances` to the linked project and deployed relay version `bc1ded2c-787f-41c3-b10f-dd0c661e9a6c`. The signed Mac app verified an active $80/year test subscription with 600 remaining test minutes and a separate 60-minute purchased test balance. All three pack prices loaded. Its test renewal displayed the actual store expiry, September 16 at 12:22 PM, with the accelerated-renewal explanation.

Validation: 292 application tests; full disposable PostgreSQL integration checks and database advisors; relay typecheck; signed Mac build and signature verification. A transaction against the deployed database reserved 45 test seconds at 3×, settled 18, verified the production balance was unchanged, then rolled back so no customer minutes were consumed. This verifies deployed metering without recording audio.

### Quantity checkout and free accounts

Apple checkout supports 1–10 units of a selected pack in one StoreKit transaction. The native catalog returns store-formatted prices for each quantity; the UI never parses currency strings. Web Billing currently offers one unit per checkout because the installed web SDK does not expose quantity purchasing.

Verified RevenueCat webhook and v2 purchase quantities determine credit. Older records without quantity grant one unit initially; later verified quantities add only the missing units. Refund tombstones remain empty through quantity recovery. Purchase confirmation waits for the full requested quantity, and duplicate events cannot grant twice. The quantity RPC remains service-only.

Free accounts can enter the app with their one-time 30-minute allowance and buy packs without Pro. Exhausting free minutes does not block entry to the app; the server still enforces available minutes for sessions. Production checkout retains the existing release gate. Test-mode subscription UI displays billing cadence instead of presenting accelerated StoreKit expiration as a normal renewal date.

Account refresh is beside Usage. Purchase confirmation also retries automatically while pending; an explicitly cancelled checkout with no completed transaction can be dismissed after server reconciliation.
