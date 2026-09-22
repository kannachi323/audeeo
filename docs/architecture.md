# Audeeo architecture

Audeeo is a desktop app for macOS and Windows. React and TypeScript own the
interface and session lifecycle. Rust provides the Tauri shell, authentication
callbacks, local storage, and desktop capture. Swift provides macOS audio,
AppKit presentation, and Mac App Store billing.

```text
Microphone or desktop audio (all playback or one app)
  → 16 kHz mono PCM with input gain/mute
  → personal provider connection, or authenticated hosted relay
  → source captions, translation, and optional spoken output
  → desktop caption window and optional saved session
```

Each session captures one input. macOS uses native microphone capture and Core
Audio process taps; Windows uses WASAPI. Desktop capture excludes Audeeo when
capturing all playback. Translated speech has a separate playback path. See
[audio sources](audio-sources.md) for platform requirements and capture limits.

## Sessions and storage

`src/lib/directCaptions.ts` connects BYOK sessions to supported providers.
`src/lib/realtime.ts` connects hosted sessions to the Cloudflare relay in
`services/session-relay`. Shared caption, language, context, and billing types
live in `shared/`.

Supabase handles account authentication and cloud history. Desktop OAuth opens
the system browser and receives the callback through a temporary loopback
listener. Local caption history and retryable uploads are owned by the client;
saving sessions is optional. Context settings remain local. See
[Supabase setup](supabase.md) and
[session intelligence](session-intelligence.md).

## Billing and presentation

Hosted usage is enforced by server-side reservations. RevenueCat supplies
subscription and purchase state; clients cannot grant themselves allowances.
Mac App Store builds use the native SDK, while direct builds use browser checkout.
See [billing](revenuecat.md) and [minute packs](minute-packs.md).

The Mac caption surface uses public AppKit views while the session WebView stays
alive. Settings restore that same WebView. Native controls send actions to the
React session controller; caption presentation does not own the provider stream.
Windows uses the Tauri window and React caption interface.

The website is a separate Vite project in `website/`.
