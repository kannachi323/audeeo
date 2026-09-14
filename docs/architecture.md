# Audeeo architecture

Audeeo is a Tauri 2 / React application with native Apple capture and presentation. The legacy prototype is absent from this working tree. There are no assistant, summary, chat, delegation, or general agent features.

```text
macOS private Core Audio process tap / native AVAudioEngine microphone
  → 16 kHz mono PCM → authenticated Cloudflare WebSocket
  → Deepgram Nova-3 (explicit en or zh)
  → revisioned transcript → serialized stable-phrase translation
  → Qwen-MT-Flash → source and translated segment events
  → React controls / public AppKit subtitle panel / iOS native AVKit PiP
```

iOS owns capture, its URLSession WebSocket, subtitle rendering, and a bounded finalized-text disk outbox in Swift. React controls it through commands. It does not depend on a canvas, video element, Web Audio, or WebView timers for ongoing capture. Browser microphone capture is a foreground development fallback. iOS other-app playback capture remains disabled; the broadcast extension is not integrated.

The Mac uses one NSWindow for captions and Settings. A shared presentation reducer tracks session phase, playback, and page; only session/playback selects normal versus overlay level. A private Core Audio process tap excludes Audeeo, mutes direct source playback while read, and supplies independently controlled source monitoring and provider input. Translated PCM plays through a second native engine. The minimum app targets remain macOS 13 and iOS 15; system mixing requires macOS 14.2+. See [OpenAI streaming](openai-captions.md) for lifecycle and buffering details. Android has no release-ready native adapter.

`shared/pipeline.ts` owns segment IDs, time ranges, revisions, language pair, sequence, provisional/final flags, source text, translation and completion state. Interim source text appears immediately. Only provider-finalized chunks are translated. Qwen receives one user message and documented translation memory (last four pairs), terminology, and domain controls. No language is inferred from forced-language recognition output. No Lite runtime fallback exists.

Translation is serialized with 32 pending items and a 256-segment working set. A revision superseding an in-flight request invalidates the result. Failure preserves original text. Stop requests Deepgram CloseStream, then drains translation for up to 12 seconds; unfinished work becomes an explicit translation-error instead of hanging. Reconnection starts a distinct session rather than silently replaying uncertain audio. UI display keeps the most recent 128 segments; this does not define the translation source or synchronized history.

## Identity, history and metering

Apple/Google use Supabase PKCE. Apple platforms use a process-owned system authentication session and Keychain storage; Windows uses the default browser, a short-lived random-port loopback callback, and encrypted local credential storage. Callback URLs are validated and queued until the WebView is ready. OAuth credentials and redirect allowlists need project configuration. Provider keys exist only in relay secrets. The first WebSocket message authenticates using a Supabase access token; tokens never enter the socket URL. Supabase validates identity, and the socket is bounded by token expiry and session duration.

Owner-scoped sessions/segments use RLS and a composite owner/session foreign key. Finalized source text can sync before translation; version guards prevent stale pending writes replacing completed translations. Text-only deletion tombstones prevent offline resurrection. Outboxes retain finalized text across network loss; iOS writes it natively during WebView suspension, then hands it to the shared sync outbox on foregrounding. Account deletion cascades through Supabase-owned text and usage.

Usage is enforced by service-role-only PostgreSQL reservations, serialized on the owner's allowance row across devices. Each reservation charges up to 15 seconds before service is supplied. Duplicate reservation IDs do not charge twice. Unused reserved seconds are currently not refunded; interruption can conservatively consume up to 15 seconds. The free allowance is lifetime-capped. A paid billing-period allowance resets on a verified new period and has no rollover. Commercial allowance amounts remain explicit database configuration rather than client claims. Two operator accounts receive unlimited, non-billable reservations based only on their verified `auth.users.email`. A user may instead provide an OpenAI or Soniox key for the current app process; the relay uses that key without consuming allowance and does not persist or echo it. Server authorization does not trust a local purchase-success flag.

RevenueCat webhook IDs are deduplicated after authoritative subscriber reconciliation. Older reconciliation snapshots cannot overwrite newer ones. Apple restoration uses the native SDK; web refresh retrieves the signed-in customer. Both reconcile server entitlement state. Native iOS Paywalls and Customer Center are exposed through the Swift bridge; browser paywalls use purchases-js. Monthly included seconds renew at purchase anniversaries for yearly subscriptions, and session startup refreshes authoritative entitlement state. The Swift package contains the real RevenueCat adapter; the minimal Swift-only build reports purchases unavailable. The purchases-enabled archive and resource-bundle packaging must be used for release.

Qwen streaming TTS and a bounded native playback adapter exist for integration/qualification. Spoken output is deliberately disabled in the shipped controls until playback routing, feedback prevention, and speech allowance charging are connected and verified. This is unfinished implementation, not a tested feature.

## Mac presentation and identity

React owns the small authentication/settings companion and the session controller. No authenticated session means sign-in only. A successful session opens the native AppKit overlay and hides the companion. The overlay remains visible at rest, during capture and after stop; settings open independently and do not terminate capture when closed. Sign-out ends the session and dismisses the overlay.

The overlay uses a clear `NSPanel` and native layers, not a transparent WebView. Running Transparent mode has no surface fill, border or window shadow; a separate hover/keyboard control row stays readable when revealed. Solid mode and system/user reduced transparency supply an opaque caption surface. Native buttons emit only session-toggle or settings/account intents back to React. Presentation receives source/translation text plus appearance/status preferences; it does not drive the transcript or translation pipeline.
