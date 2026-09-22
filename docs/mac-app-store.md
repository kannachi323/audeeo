# macOS App Store release

Target: **Apple silicon and Intel**, macOS 13 or later. Bundle ID
`com.mattdev727.audeeo`; Apple team `7D6BVN4W87`. Operator: Matthew Chen.
Support and privacy contact: **mattdev727@gmail.com**.

## Implemented release changes

1. Removed Tauri's `macos-private-api` Cargo feature, its configuration switch,
   and private WebKit background access. The macOS overlay now draws captions
   with public AppKit views over a clear window. The session WebView remains
   attached but hidden during overlay mode, and returns for Settings. Background,
   border, font, text, controls and whole-overlay opacity follow saved preferences.
2. Added `npm run release:mac` with universal builds, profile/identity checks,
   incremental build numbers, sandbox verification, and signed `.pkg` creation.
   The script never uploads a build or submits it to review.
3. Packages the app privacy manifest and RevenueCat 5.89.0's resource manifest
   before signing. This pinned SDK does not call `Bundle.module` in its Sources;
   the build fails for review if a future SDK introduces that dependency.
4. Added privacy, terms, and support pages, accessible in-app links, AI setup before app use,
   consent withdrawal, and screen context included in the required AI agreement. Permission is scoped to the account and this device.
5. Discloses the currently configured 600-minute monthly allowance, monthly
   resets on both plan lengths, renewal/cancellation, and legal links. Removed
   the hardcoded annual savings claim. StoreKit supplies localized full prices.
6. Account deletion validates the user through Supabase, freezes new relay
   operations, revokes Apple authorization where applicable, requests RevenueCat
   deletion, and then hard-deletes the Supabase user and cascading data. Apple
   validation proof is a digest in server-controlled `app_metadata`, allowing
   retries after revocation without storing the Apple credential on the server.

## Build commands

For everyday development, `npm run desktop` builds a signed `Audeeo Dev.app` around the debug executable and loads `http://localhost:1420`. `tauri.macos.conf.json` selects `scripts/desktop-cargo.py`; its Cargo target runner copies the real Info.plist, icon, privacy manifests, and RevenueCat resources, signs and verifies the bundle, then executes it under Tauri’s process supervision. Frontend changes still hot-reload. Native rebuilds repackage and re-sign automatically. A bare ad-hoc-signed debug executable can return StoreKit product-service errors even when the RevenueCat SDK is linked; use the normal dev command rather than launching `target/debug/audeeo-app` manually. This does not build a release or deploy any service.

Keep `AUDEEO_DISTRIBUTION=app-store` and `AUDEEO_BILLING_ENVIRONMENT=sandbox` in the root `.env` for development. Distribution packaging sets billing only for its own process; it never edits `.env`. For an explicitly requested local **development-signed sandbox** smoke build:

```sh
npm run release:mac -- --local
```

This creates `src-tauri/target/universal-apple-darwin/release/bundle/macos/Audeeo.app`.
Local mode preserves sandbox, network-client/server and audio-input permissions but
omits the restricted App/Team identifier entitlements, which require a profile.
It is explicitly unsuitable for submission. Distribution mode retains them.

Browser sign-in uses a temporary listener bound only to `127.0.0.1` on a random
port, with a five-minute timeout and PKCE verification. macOS requires the
network-server entitlement even for this local callback. Packaging verifies both
network entitlements so a sandbox build cannot silently lose sign-in support.

For distribution, install an Apple Distribution / Mac App Distribution application
identity and a **Mac Installer Distribution** identity with their private keys.
Create a **Mac App Store Connect** provisioning profile for the bundle ID and
matching distribution certificate. Set these variables in your shell:

```sh
export AUDEEO_MAC_SIGNING_IDENTITY='3rd Party Mac Developer Application: Matthew Chen (7D6BVN4W87)'
export AUDEEO_MAC_INSTALLER_IDENTITY='3rd Party Mac Developer Installer: Matthew Chen (7D6BVN4W87)'
export AUDEEO_MAC_PROFILE='/absolute/path/to/downloaded.provisionprofile'
export AUDEEO_BUILD_NUMBER='2' # Increase for every upload.
npm run release:mac -- --testflight
```

`--testflight` creates `Audeeo-TestFlight-<build>.pkg` with sandbox billing and
distribution signing. Apple uses sandbox purchases in TestFlight. The relay still
requires every tester's account ID in `BILLING_TEST_USER_IDS`; this first beta is
limited to Matthew's existing approved account. Subscription allowance and pack
balances remain separate from production. Do not promote this sandbox-configured
build to the public App Store; create a production build without `--testflight`.
Plain `npm run release:mac` scopes billing to production. `--preflight-only`
checks configuration, certificates, profile, backend readiness, and private APIs
without compiling. Each signed package has a matching `.verification.json` with
its version, billing mode, architectures, hash, and local verification results.
Local checks do not replace Apple's upload validation or a TestFlight smoke test.

Use the actual installed certificate names. No distribution identity or profile
was present during the initial audit; both were created and installed on
September 15, 2026. The profile is
`artifacts/signing/Audeeo_Mac_App_Store_2026.provisionprofile` and both distribution
certificates expire in September 2027. Private keys remain in the local login
keychain and ignored signing directory. Developer ID is for distribution outside
the Mac App Store and is not a substitute. Separate notarization is not required
for Mac App Store submission.

The script checks `/v1/release-readiness` before a distribution build. This checks
configuration availability, not successful real Apple purchases or revocation.

## Apple revocation configuration

Production configuration was verified on September 15, 2026. The client ID is
`com.mattdev727.audeeo-web` (a single Services ID, not the comma-separated list
accepted in the Supabase provider settings). Both Apple revocation and RevenueCat
deletion credentials are installed on the production relay. Apple's token endpoint
accepted the client credentials and rejected the deliberately invalid test token;
this does **not** establish successful deletion of a real Apple-linked account.

Set server-only `APPLE_CLIENT_ID` to the **OAuth Services ID configured in
Supabase**, not an unrelated native bundle ID. Set `APPLE_CLIENT_SECRET` to a
valid Apple client-secret JWT for that Services ID. It must match the provider
that issued Supabase's `provider_refresh_token`. Rotate the JWT before expiry.
Store both values in the ignored root `.env` for local work and upload them as
Cloudflare Worker secrets to `audeeo-session-relay`. Never put them in Vite config,
the app binary, tracked files, logs, or chat.

Apple-linked users can reconnect with Apple from the deletion confirmation if
their session lacks the provider refresh token. Deletion requires a second
explicit confirmation after reconnecting. If provider cleanup fails, the account
remains available for retry; new relay operations are blocked once deletion has
started. RevenueCat deletion is asynchronous and does not cancel a subscription.

## App Store Connect fields prepared

Existing app: **Audeeo: AI Audio**, Apple ID `6811510356`. Saved the macOS
**0.1.0** draft description, keywords, support and marketing URLs, copyright, and
review notes. Added the public privacy policy URL. No version was added for review.

App Store Connect reports the updated **Apple Developer Program License
Agreement** must be accepted by the account holder before submission. EU trader
status is also unset. These require the operator's decisions. The draft currently
has no screenshots, uploaded build, review credentials/contact details, or completed
privacy questionnaire. Do not equate a signed package with a complete submission.

| Field | Value / action |
| --- | --- |
| Platform | macOS only |
| Name | Audeeo |
| Subtitle | Live captions and translation |
| Support URL | https://audeeo.app/support |
| Privacy policy URL | https://audeeo.app/privacy |
| Terms URL | https://audeeo.app/terms |
| Support email | mattdev727@gmail.com |
| Suggested category | Utilities (confirm the category chosen in App Store Connect) |
| EULA | Apple standard EULA plus Audeeo service terms |
| Encryption | Review the actual encryption usage and answer Apple's export-compliance questions; do not guess an exemption. |

### Suggested description

Audeeo turns speech and desktop audio into live captions and translations. Keep
captions in a floating panel while you watch a presentation, join a meeting, or
listen to a lecture. Choose microphone, desktop, or application audio, adjust
caption appearance, and add context for names and specialized terminology.

With Save sessions enabled, read completed sessions on another device signed into
the same account. Saved history expires after 30 days. Generate session summaries
and ask questions about a transcript. Cloud features require an internet
connection and your permission to send content to the named AI providers.

Audeeo Pro costs $8/month or $80/year and includes 600 usage minutes per monthly
allowance period, without rollover. Subscriptions renew automatically until
cancelled. Signed-in users can also buy non-expiring packs of 60, 180, or 600
usage minutes. Captions consume 1 usage minute per minute; spoken translation
consumes 3. StoreKit displays localized prices before purchase. AI output may
contain errors.

### Review notes to complete

- Supply a dedicated reviewer account with working access; never your personal
  account or API keys. Enter credentials only into App Store Connect Review Info.
- Explain the three audio sources, microphone/screen-audio permissions, floating
  caption panel, and completed-session-only history synchronization.
- Explain AI setup and the included screen-context permission. Capture happens
  only when the user clicks Fill from screen; there is no repeated consent modal.
- Point out Account → Restore purchases, Manage subscription, and Delete account.
- Submit the first subscription products with the first app version as required
  by App Store Connect. Confirm RevenueCat offering and product mapping.
- Capture screenshots of the actual final app with fictional/sample content.
  Include live captions, settings, and history. Do not use a login-only screenshot
  set or expose real transcripts, account information, or API keys.

## Privacy labels and required-reason APIs

The app manifest conservatively declares account email/ID, purchase history,
audio, screenshots, and other user content, linked to the account for app
functionality; no advertising tracking. Verify labels against actual provider
retention and configurations before submission. Manifest declarations do not
replace the App Store Connect privacy questionnaire.

The app declares file-timestamp access for its own files (`C617.1`) and boot-time
access for elapsed-time calculations (`35F9.1`); RevenueCat supplies its own
UserDefaults declaration. Audit again after native dependency changes. Do not add
an arbitrary reason just to silence an Apple upload warning.

## Required final verification

### September 16 production package

The current distribution candidate is **0.1.0 (5)**:
`artifacts/mac-app-store/Audeeo-5.pkg`. It uses production billing, includes
the updated eight-category privacy manifest, and passes universal architecture,
profile, sandbox entitlement, application signature, and installer signature
checks. Its `.verification.json` records the hash. It has not been uploaded or
validated online by Apple. Builds 1–3 are superseded for this submission.

See [the current submission checklist](app-store-submission.md) for App Store
Connect draft status and remaining release actions; the older audit below is
historical, not a statement of current submission readiness.

### September 16 TestFlight package

Built **0.1.0 (2)** as `artifacts/mac-app-store/Audeeo-TestFlight-2.pkg`
with sandbox billing for the existing approved tester. The universal Apple silicon
and Intel app and installer are signed with the App Store distribution identities.
Strict app signature checks, sandbox/network entitlements, provisioning profile,
both privacy manifests, build number, and executable architectures passed.
The frontend bundle was checked for sandbox billing, the hosted relay, and
accidental inclusion of server credentials. The developer `.env` remains unchanged.
The matching `.verification.json` records the package hash and checks.
This package has **not** been validated online by Apple or uploaded; installation
and purchase verification through TestFlight remain outstanding.

### Earlier release audit and remaining checks

The first release is **0.1.0**. Store builds inherit this version from
`src-tauri/tauri.conf.json`; the earlier `1.0.0` store-only override was removed.
The existing `Audeeo-1.pkg` is an older 1.0.0 artifact and must be rebuilt.

The latest development code uses onboarding consent (version 3). Rebuild the
signed installer and deploy the matching website policy copy before releasing
this update; the previously generated package uses the earlier consent flow.

Verified locally: universal `arm64` + `x86_64` executable, strict signature and
sandbox entitlement checks, bundled privacy manifests, successful launch of the
development-signed sandbox app, native opaque-window presentation checks, and
automated consent/deletion tests. Privacy, terms and support pages are deployed
at `audeeo.app`; the production release configuration endpoint reports ready.

Hosted email authentication is disabled; onboarding now only offers email after
the public provider settings confirm it is enabled. Apple and Google are enabled.
A disposable email-based account could not obtain a session for the live deletion
test; all disposable accounts were cleaned up. Real provider deletion and local
cleanup still require an authenticated test account.

Mac App Store signing credentials and the matching profile are installed. The
application and installer certificates were verified against the locally generated
private keys. The signed installer is `artifacts/mac-app-store/Audeeo-1.pkg`.
The packaging script verifies the profile's certificate fingerprint, app/team IDs,
expiration, app signature, sandbox, privacy resources, and installer trust chain.
External privacy links were verified from the sandbox app. All 230 automated tests
passed in the latest full run, and the frontend build and relay typecheck passed.
No package has been uploaded or submitted to Apple.

- [ ] Install the distribution-profile build on a clean Mac / TestFlight.
- [ ] Test Apple silicon and a physical Intel Mac, including the oldest supported
      OS and the current OS. Cross-compilation does not establish hardware support.
- [ ] Test microphone, desktop and app capture; denial/revocation; full-screen
      context capture; external policy and subscription links inside the sandbox.
- [ ] Complete real App Store sandbox purchase, cancellation, restore, expiry,
      and account switching. Confirm backend allowance and renewal behavior.
- [ ] Verify Apple-linked deletion with a dedicated test account and working
      revocation credentials; test retries after provider errors.
- [ ] Verify email account deletion end to end, including local cleanup.
- [ ] Verify long sessions, network loss, lock/unlock, audio-device changes,
      session stop/crash recovery, and history sync across devices.
- [ ] Complete Apple agreements, tax/banking, age rating, privacy labels,
      export compliance, product review information, and screenshots.
- [ ] Validate the signed package with Apple, upload to TestFlight, then submit
      the reviewed version. Passing local tests is not App Store approval.

References: [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/),
[subscriptions](https://developer.apple.com/app-store/subscriptions/),
[account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
[Tauri App Store packaging](https://v2.tauri.app/distribute/app-store/), and
[RevenueCat customer deletion](https://www.revenuecat.com/docs/api-v1/customers).
