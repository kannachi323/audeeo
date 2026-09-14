# Implementation record

The starting tree was already dirty: a C++ deletion and an untracked Tauri migration. No reset, checkout, clean, or commit was performed. No applicable AGENTS.md was found in the workspace or its parent chain.

## 1. Audit

The app directly exposed a Deepgram key through Vite, used a generic model picker, did not translate, and rendered canvas/video PiP. The relay forwarded an unrelated Qwen realtime protocol with a shared development token. CI and architecture documents described deleted C++. Platform capabilities incorrectly advertised desktop-wide support. macOS used Tauri's private transparency feature. No authentication, synchronized history, purchases, server ledger, or tests existed in the migration.

Misty references inspected: `~/misty-org/misty/DESIGN.md`, `src/styles/styles.css`, `src/shared/ui/button.tsx`, and `icon-button.tsx`. Audeeo uses the charcoal tokens, system typography, 36px controls, 16px Lucide icons, 6px control corners and 8/12/16px rhythm.

Further milestone results and exact release blockers are recorded in `verification.md` and `release.md`. A component that compiles is not a signed application or a physical-device result.

## 2. Native foundations — implemented; physical proof pending

Removed the private Tauri macOS feature/config flag. Added a public AppKit subtitle panel with recording status, start/stop and access to React controls, plus an opaque reduced-transparency fallback. Added AVAudioEngine microphone capture, Keychain and native OAuth bridges. ScreenCaptureKit now excludes Audeeo's process, validates PCM format and reports interruptions. iOS has native microphone capture, URLSession relay ownership, AVKit sample-buffer PiP and owner-scoped finalized text buffering. The canvas/video experiment was removed.

Verified: Mac executable and development app bundle build; iOS target compiles. Blockers: unlocked Mac/physical Apple devices and signed validation; iOS other-app playback broadcast extension integration and provisioning remain unfinished.

## 3. Recognition and translation — code/tests complete; live proof pending

Replaced direct provider access and unrelated Qwen realtime relay with authenticated Deepgram → revisioned source segments → Qwen-MT-Flash translation. Stable provider-finalized chunks are translated from the transcript stream, not visible text. Added bounds, revision rejection, ordering, error isolation and bounded shutdown. Only explicit Chinese/English modes are exposed; no unsupported automatic direction or Lite fallback.

Verified: deterministic stream/relay tests and Worker typecheck. Blockers: actual provider credentials, selected deployment scope, recordings and bilingual benchmark evaluation. Flash/Lite fixtures and metrics/cost harnesses are provided; no live measurements were fabricated.

## 4. Floating overlay and sign-in companion — implemented; live integration verification pending

The September 12 7pm design supersedes the primary decorated caption window. macOS now starts with a small React sign-in window. After Supabase authentication, that window hides and the public AppKit subtitle overlay becomes the primary experience. The overlay stays above ordinary application windows and joins Spaces/full-screen auxiliary presentation. Its single bottom row contains Start/Stop, language/status text, and Settings. The centered native grip retains direct mouse tracking.

At rest the overlay is a rounded charcoal panel. While listening, the default presentation removes its background fill, border and window shadow. Controls/grip hide when the pointer and keyboard are away, and return on hover or keyboard navigation. Users can select Solid panel, keep controls visible, adjust text size, and show/hide original text in Settings → Overlay. Reduced transparency overrides clear presentation; VoiceOver keeps controls available. The gear opens the separate React settings companion without dismissing subtitles; closing settings hides only that window. Sign-out dismisses the overlay and restores sign-in. Audio/language selection, history and account live inside settings rather than the overlay toolbar.

Verified: 33 TypeScript tests, native AppKit rendering/geometry checks, web/relay checks and local Mac app bundling. The new overlay was visually inspected using an explicitly labelled native fixture with no capture/network code; the actual unconfigured sign-in window was also inspected. Rendering checks confirm zero background alpha, shadow removal, visibility controls, solid/accessibility fallback and window level. Mocked auth tests cover sign-in gating, callback cancellation/errors, settings close and sign-out. Remaining gates: real configured OAuth, live capture/presentation transitions, multi-display/full-screen behavior, VoiceOver testing, iOS physical devices and signed release screenshots.

## 5. Accounts, history and metering — implemented with release gates

Added Supabase social PKCE, native authentication, owner RLS/composite keys, idempotent finalized segments, offline outboxes, history export/delete and Supabase account deletion. Added shared row-locked allowance reservations, no-rollover period handling, authoritative RevenueCat reconciliation and duplicate webhook handling. Real native SDK code covers monthly offerings, purchase and restore. No product, allowance or commercial price was activated.

Verified: real local PostgreSQL isolation/concurrency/restore/expiration tests; native purchase SDK compilation and Mac linking. Blockers: Supabase/OAuth configuration, staging deployment, approved allowance/product decisions, packaged RevenueCat resources, sandbox purchase tests and complete provider-side account deletion. The release paywall is gated on approved product/allowance disclosures.

## 6. Speech — adapters/tests implemented; end-to-end integration pending

Evaluated Qwen's documented streaming interface and Mandarin/English voice support first. Added a server-only committed-text streaming adapter, a bounded native PCM playback endpoint with Mac device selection, and tested speech-queue/feedback policies. The normal user speech control remains disabled.

Verified: simulated streaming protocol and policy/queue tests; no live voice/latency result. Blockers: credentials/voice qualification, speech charging policy, connection of committed output to playback acknowledgments, native route selection and real feedback/Bluetooth tests. This milestone is not complete.

## 7. Release preparation — configuration/documentation drafted

Replaced stale C++ CI/docs, added Mac sandbox configuration, native SDK build support, provider/rate evidence, a review/privacy checklist and a physical-device test matrix. Preserved existing development-team values. No production deployment, live billing or store submission occurred.

Verified: local automated/build checks in `verification.md`. Blockers: all prior release gates, distribution signing and provisioning, complete privacy manifests/provider retention decisions, real support/privacy URLs, reviewer configuration and screenshots from the signed product.
