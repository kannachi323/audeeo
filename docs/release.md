# Apple release gates

This is **not** a release-ready or store-accepted build. No production deployment, live billing activation, signed archive, or store submission was performed.

## Required configuration

- Supabase project URL/publishable key/server-only secret key, migration application, Apple and Google OAuth provider credentials and redirect allowlist (`audeeo://auth/callback`). Configure Apple service identifiers and Google clients for the intended distribution. Provider verification has not run against a real account.
- Deepgram server key and selected US/EU deployment; Qwen key with Flash/Lite/TTS access and the correct workspace/region URL. The old client bundled provider credentials: rotate any previously distributed key before release. The original `.env` was preserved, not copied into new client configuration.
- Cloudflare staging deployment, origin allowlist, WebSocket soak tests, request limits, privacy-respecting operational monitoring and a recovery/runbook owner. The existing Worker relay is retained, not deployed.
- RevenueCat app public key, server secret and authenticated webhook; approved monthly and yearly products attached to `audeeo_pro`. Set restoration/transfer behavior deliberately for Supabase UUID identities. Configure free lifetime and monthly included seconds, maximum session duration, speech policy, price and currency. Defaults grant zero allowance. Configure test products only after product decisions; live activation requires authorization.
- Apple distribution identities, provisioning profiles, Sign in with Apple and purchase capability setup, App Store Connect records and approved bundle identifiers. Existing generated development-team settings were preserved; they are not evidence that release signing works.

## Native build configurations

The default build uses only public Apple APIs and an opaque Tauri WebView. `npm run tauri -- build --config src-tauri/tauri.store.conf.json` adds the Mac sandbox entitlements. Review these in a signed sandbox build: microphone and network client permissions; ScreenCaptureKit remains user-permission controlled. Check that `macos-private-api` is absent from the complete release feature graph and binary.

Tauri builds the RevenueCat-enabled static library automatically on macOS and iOS. For a prebuilt override, run `sh scripts/apple-native-build.sh macos` (or `ios`) and set `AUDEEO_NATIVE_ARCHIVE` to the absolute resulting `libAudeeoNative.a`. Normal macOS builds no longer use the purchases-unavailable stub. Copy `RevenueCat_RevenueCat.bundle` to the location required by SwiftPM's generated `Bundle.module` accessor **before signing**; verify the installed archive on a machine without the development build directory. Resource packaging is a release gate, not optional. The SDK's privacy manifest must be included.

Minimum targets: macOS 13, iOS 27. The iOS build now intentionally requires the iOS 27 SDK because ScreenCaptureKit full-display capture is the only supported device-playback path. There is no legacy fallback.

## Unfinished implementation gates

- iOS device playback: compile with the final iOS 27 SDK, then qualify the ScreenCaptureKit system picker, background `screen-capture` mode, own-audio exclusion, protected/non-shareable media errors, and caption PiP on physical devices.
- Native AppKit overlay interaction: verify authenticated handoff from the sign-in companion, clear running captions, hover/keyboard controls, gear → settings, settings close without ending capture, sign-out, multi-display and full-screen behavior. Local fixtures and mocked auth tests do not replace this live validation.
- Speech: connect the server-only Qwen TTS adapter to committed segments, server speech metering and native playback acknowledgment/backpressure; expose verified output devices/route picker. Ensure explicit device-playback opt-in. Verify headphones and feedback exclusion, including Bluetooth loss, before enabling the currently disabled control. The adapter and queue tests do not constitute working spoken interpretation.
- Purchase release packaging and paywall: the SDK adapter implements offerings, monthly purchase and restoration, and server reconciliation exists. An approved product, included-minute disclosure, localized store price, and packaged SDK resources are required before showing an actionable subscription offer.
- Provider token/cost telemetry and real audio benchmarks need completion before final commercial recommendations. The text harness alone cannot supply session-hour latency/cost measurements.
- Account deletion currently deletes Supabase text/usage and identity. Add provider-side RevenueCat customer data deletion/retention handling and Apple token revocation where applicable before releasing account deletion. Subscription cancellation remains a separate App Store action.

## Physical verification matrix — all pending

Run on a real Mac and iPhone/iPad with a signed build: permission granted/denied/revoked; microphone and ScreenCaptureKit capture; iOS device playback + PiP and microphone + PiP; repeated foreground/background and PiP transitions; 60-minute and maximum-duration sessions; lock/unlock; wired and Bluetooth routes; Bluetooth disconnect during speech; capture/translation network loss; expired JWT; concurrent devices spending the last allowance; App Store purchase, cancel, renewal, expiry and restore; account switching with unsynced history; stop, close and crash recovery. Record device/OS/build ID and results. Simulators or compile checks cannot satisfy these rows.

## Privacy and review materials

Publish a real privacy policy and support URL before release. Disclose transient audio transmission to Deepgram, transcript transmission to Qwen, selected regions, Supabase identity and automatic text history, RevenueCat purchase identifiers and usage reservations. Explain the per-session don’t-save option and that Audeeo does not retain raw audio by default. Confirm provider retention/training controls contractually; this app's raw-audio policy is not a claim about provider retention. Include local unsynced text, account deletion and subscription management behavior.

Complete App Store privacy labels from actual collection and SDK behavior, including audio, user content, identifiers and purchases as applicable. Audit privacy manifests and required-reason APIs for all included SDKs; do not submit an empty guessed declaration. [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/), [review guidelines](https://developer.apple.com/app-store/review/guidelines/).

Reviewer instructions: sign in using the supplied review configuration; choose the speaker language; start device-playback or microphone captions; approve Apple's sharing picker when using device playback; reverse the pair manually; show/hide the Mac subtitle panel or initiate native iOS PiP; stop and inspect saved history; exercise don’t-save; export/delete history; restore the sandbox subscription. State each capture restriction. Provide a supported test audio fixture and review account through App Store Connect, never in this repository.

Capture store screenshots from the actual signed app at required device sizes: floating captions and its bottom toolbar, Overlay settings, audio/language settings, history, and sign-in/account. Local browser screenshots are UI QA only, not App Store-ready evidence. Do not stage fake translations or hide unavailable features in release screenshots.

The product intentionally supports only Apple's iOS 27 ScreenCaptureKit path. Build and store eligibility still require verification against the final shipping SDK. See [Apple's iOS ScreenCaptureKit sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios).
