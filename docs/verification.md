> Current streaming, audio-routing, and window changes are recorded in [September 13 verification](streaming-window-verification.md). The September 12 two-window/UI descriptions below are historical and superseded; earlier billing/database checks were not rerun unless stated in the new record.

# Verification record — 2026-09-12

These results concern the current Tauri/Swift/Worker implementation. The old C++ latency and device claims have been removed; they are not evidence for this architecture.

## Automated and build checks

- 48 TypeScript unit/integration tests pass. They cover provisional source publication, transcript revisions, stale translation rejection, phrase ordering, duplicate revisions, translation failure isolation, bounded queues, provider timestamps, stop draining and shutdown timeout, documented Qwen translation controls, owner-scoped outboxes, reconnect retries, updates during sync, deletion, audio feedback policy and speech backlog. UI tests cover direction controls, opt-out, and keyboard collapse/focus restoration. Relay tests cover origins, authorization, unavailable provider configuration, and authoritative purchase restoration. TTS tests use a simulated WebSocket, not the real provider.
- `npm run build`: React/TypeScript and Vite production build pass.
- `npm --prefix services/session-relay run typecheck`: Worker typecheck passes.
- `npm run test:database`: the real migration passes in an isolated disposable PostgreSQL 14 cluster. Checks include owner RLS, composite-owner writes, service-only metering, concurrent reservations, duplicates, entitlement restoration/expiration, stale updates, deletion tombstones and account cascading. This is not a deployed Supabase integration test.
- `cargo build --manifest-path src-tauri/Cargo.toml`: Mac executable links.
- `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios`: iOS Rust and Swift bridge checks pass against the installed SDK. This is not an iOS archive or device run.
- `swift build --package-path native/apple --product AudeeoNative`: actual RevenueCat 5.89.0 purchase adapter compiles. A Mac executable also linked with this static archive through `AUDEEO_NATIVE_ARCHIVE`. Default macOS Tauri builds use the adapter's unavailable path until the SDK archive is supplied; iOS now builds and links RevenueCat automatically.
- `npm run tauri -- build --debug --bundles app`: created a local development `Audeeo.app`. This is not a distribution-signed App Store archive.
- `npm audit`: root application dependency audit reports zero known vulnerabilities after compatible transitive updates.

## UI and native window inspection

The actual Mac build now shows only the small sign-in companion until authenticated. The rounded native overlay is the primary signed-in presentation; the companion becomes Settings when opened from the overlay gear. Its Audio & languages and Overlay components were inspected at 400px in a labelled browser appearance fixture. That fixture is not a production entry point and has no authentication/network/capture implementation.

An isolated native overlay preview was inspected at rest and with clearly labelled Mandarin/English sample subtitles. The running rendering has a genuinely clear background rather than a translucent WebView. Automated checks assert background alpha zero, no window shadow, control visibility on hover, solid-mode selection, reduced-transparency override, source visibility, pending-state start protection, window level and Spaces flags. These are local rendering checks, not live transcription or proof of behavior above OS-owned security dialogs/full-screen applications.

Run the native checks on a Mac with a display:

```sh
xcrun swiftc native/apple/Sources/AudeeoNative/MacPanel.swift native/apple/Tests/OverlayPresentationChecks.swift -o /tmp/audeeo-overlay-checks
/tmp/audeeo-overlay-checks
xcrun swiftc native/apple/Sources/AudeeoNative/MacPanel.swift native/apple/Tests/WindowGeometryChecks.swift -o /tmp/audeeo-window-checks
/tmp/audeeo-window-checks
```

The optional `/tmp/audeeo-overlay-checks --preview` launches explicitly labelled appearance fixtures and makes no network/audio requests. TypeScript tests use mocked identities for authenticated navigation, preference updates, settings-window hiding, sign-out and OAuth callback cancellation/exchange errors; no test bypass is present in the shipped app. Actual OAuth/capture lifecycle checks require configured services and a test account.

Earlier native grip validation measured a 120px left / 80px down move and a 10px keyboard move. The same direct AppKit mouse tracking is retained. Standard `performDrag` calls had previously returned without moving under automation, so a no-error result alone is not considered movement evidence. Multi-display transitions, real VoiceOver use and iOS touch/PiP remain unverified.

## Benchmarks and device results

The Flash/Lite text benchmark was invoked without credentials and correctly reported its missing Qwen key/regional endpoint; it made no requests. The costing tool refused unmeasured example metrics. No latency, quality advantage, token cost per real session hour or first spoken-output result is available.

All physical capture, PiP, route changes, permission revocation, long sessions, background behavior and App Store sandbox-purchase checks remain pending. See [release gates](release.md) for the exact matrix. A compile check is not physical verification, and a simulated provider response is not proof of API access.

## RevenueCat web and iOS integration

- `npm run check`: 48 tests pass; frontend production build and relay typecheck pass. New checks cover platform routing, account switching during checkout, entitlement-based access, cancellation, missing offerings, unsafe management URLs, late component results, server sync failure after purchase, native focus refresh without restoration, and monthly allowance periods for yearly subscriptions.
- RevenueCat 5.89.0 and RevenueCatUI compile for both iOS devices (Release) and the simulator.
- `npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci`: complete arm64 simulator app build passes. The app contains both RevenueCat resource bundles. The native archive is thinned to the Rust target architecture before linking.
- Output: `src-tauri/gen/apple/build/arm64-sim/Audeeo.app`. This is an unsigned simulator build, not an App Store-signed archive or a completed StoreKit purchase test.
- The supplied Test Store key is configured locally. StoreKit sandbox/TestFlight purchase verification remains dependent on an Apple public SDK key and dashboard/App Store Connect product configuration. No live purchase or remote dashboard configuration was performed.


### Controls popover correction (2026-09-13)

Read-only reference: Misty's `GlobalMisty.tsx`, `MistyModelPicker.tsx`, `shared/ui/popover.tsx`, `MistyDesktopSurface.tsx`, and `infra/desktop_pet.rs`. Its DOM menus live inside the host viewport; its desktop surface is created transparent with no native shadow. Audeeo now uses that transparency policy from creation. AppKit owns edge resizing; no per-drag JS sizing loop is installed.

Audeeo's requirement to extend dropdowns outside the caption window needs native hosting. A single hidden, unparented Tauri renderer supplies the controls tree to an AppKit `NSPopover`. The host is never shown or focused. React acknowledges rendering before presentation. AppKit handles placement and outside dismissal; presentation IDs reject stale dismissal events. Opening menus does not change the caption frame. Keyboard Escape closes controls and restores trigger focus. The renderer is preloaded with background throttling disabled, and its capabilities permit only event exchange.

Automated checks: `npm run check` (88 frontend tests, build, relay typecheck); AppKit `ControlsPopoverChecks.swift` (real WKWebView reused, host hidden, frame unchanged across open/close), `WindowGeometryChecks.swift`, and `OverlayPresentationChecks.swift`. Signed debug bundle built with the existing Apple Development identity. These are automated checks, not confirmation of physical left-edge/corner dragging, monitor crossing, or a running capture session. The UI automation app inventory did not expose the running Audeeo process.


### Tao content-view panic correction

The first NSPopover implementation removed the hidden host's root content view. Tao 0.35.3 `platform_impl/macos/window.rs:1568` unconditionally unwraps that view in `ns_view()`, so subsequent runtime access panicked. The fix retains the native host root and reparents only its embedded WKWebView. The native regression check now models Tao's root-plus-webview hierarchy and checks root identity after showing, resizing the hidden host, dismissing, and reopening controls. The earlier bare-WKWebView test did not model this framework invariant.

The signed app was rebuilt and launched after this correction. Automated AppKit checks pass; opening controls through the full running Tauri UI is not manually verified because the UI automation resolver maps the Audeeo path to an obsolete bundle identifier. No bundle identity was changed to work around that tooling issue.
