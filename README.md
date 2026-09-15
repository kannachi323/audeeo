# Audeeo

Desktop-first live captions and Mandarin ↔ English translation, built with Tauri, React, native Apple audio/presentation, a Cloudflare relay, and Supabase. The Apple release is in development; see [release gates](docs/release.md).

The current implementation provides one caption/settings window, a desktop microphone/playback PCM mixer with independent model-input gain and mute, application isolation where the operating system exposes it, a streaming relay with separate OpenAI and Soniox backends, and owner-scoped text history/usage enforcement. Desktop playback capture requires macOS 14.2+ or Windows 10 build 20348+. Mobile retains its existing single-input modes. iOS requires iOS 27 and uses ScreenCaptureKit device playback plus native caption PiP; there is no ReplayKit fallback. See [audio capture and model-input mixing](docs/audio-sources.md) and [streaming behavior and verified limits](docs/openai-captions.md).

## Local development

```sh
npm ci
npm --prefix services/session-relay ci
cp .env.example .env
npm run dev
# Or: npm run desktop
# Only when RELAY_URL=http://127.0.0.1:8787:
# In another terminal: npm --prefix services/session-relay run dev
```

Configure the root `.env` for both app and local relay. Only the explicit public allowlist in `vite.config.ts` enters the frontend bundle; server secrets stay in the relay. Use `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` for the app and `SUPABASE_SECRET_KEY=sb_secret_...` for the relay. Secret keys are sent only in the `apikey` header; user authorization uses the signed-in user’s access token. Legacy `anon` and `service_role` API keys are not configured by this integration. Restart development processes after changing configuration. Production relay secrets must be configured in Cloudflare separately. Apply all Supabase migrations with `supabase db push` and configure an explicit test allowance before a live caption session. Never bundle provider keys. Authentication supports Google, Apple, and confirmed email/password accounts. See [Supabase setup](docs/supabase.md) for provider credentials, redirects, RLS, and verification. The app development/build commands do not deploy services.

```sh
npm run check
npm run test:database # local PostgreSQL tools; creates and removes an isolated cluster
cargo build --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios
swift build --package-path native/apple --product AudeeoNative
```

Space starts/stops when focus is outside a control; Escape collapses expanded controls. Native permission prompts remain user-controlled.

See [architecture](docs/architecture.md), [providers and benchmarks](docs/models.md), [verification](docs/verification.md), and [milestones](docs/milestones.md). No latency, quality advantage, physical-device result, or store acceptance is claimed without evidence.

## Current window controls

Sign in with Apple or Google, then use the bottom caption toolbar for context, source, mode, languages, audio, and silence controls. Translation context opens as the leftmost compact popover; Settings remains for appearance, providers, text history, and account controls. Saved sessions can be summarized on demand and expanded into titles, chapters, terminology, exact quotations, and transcript-grounded Q&A. Settings and captions animate within the same window; Back or Escape returns to captions without stopping audio.

The window behaves normally while idle. An active listening session or pending audio playback automatically raises it above ordinary windows; opening Settings keeps that level until the session finishes and playback drains. Overlay captions can have a clear background and controls that appear on hover or keyboard focus. The drag grip and ⌘⌥ arrow keys move the window. Reduce Motion and Reduce Transparency are respected.

Live use requires configured `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `RELAY_URL`, plus server-side provider configuration. Public configuration uses the explicit allowlist in `vite.config.ts`; provider secrets stay server-side. Native and browser appearance fixtures are labelled test-only previews, not recorded/live sessions.

## Subscriptions

See [RevenueCat web and iOS setup](docs/revenuecat.md) for product mapping, public keys, paywalls, Customer Center, server reconciliation, and iOS build/testing instructions.

Caption modes use one provider session at a time. Audeeo-funded subscriptions default to Soniox through its official Node SDK; see [Soniox setup, provider switching, and live tests](docs/soniox-captions.md). Users can still choose either Soniox or OpenAI with their own API key. Set the corresponding server-only provider keys in `.env` and in the deployed Worker. Soniox currently returns translated text only; OpenAI translation also returns generated audio and remains billed by audio duration. See [OpenAI captions](docs/openai-captions.md).


### Desktop sign-in storage

On macOS and Windows, Audeeo stores its sign-in session and OAuth verifier in `~/.audeeo/.config/auth.json`. Writes are atomic and run on a blocking worker. On macOS, the folders use mode `0700` and the plaintext file uses `0600`. Windows inherits access control from the user's profile. Existing Apple Keychain entries are neither read nor deleted. Sign in once after upgrading to create the new session file. Display preferences continue to use the existing app storage. iOS storage is unchanged.

## License

[MIT](LICENSE) © 2026 Matthew Chen.
