# Direct Mac distribution and BYOK

Desktop onboarding offers Soniox/OpenAI personal keys and the optional Audeeo account. Personal-key sessions connect directly over native WebSockets, without an Audeeo access token or relay. Saved keys use the existing OS-user-restricted native credential file (not Keychain). Audio goes to the chosen provider. Soniox receives supplied context; OpenAI direct captions do not currently use that context. Provider fees apply; translated OpenAI audio may be generated/billed even when playback is muted.

BYOK history is off by default. When enabled it remains in app-local storage, capped at 100 sessions/2 million characters, with 30-day pruning on access. Cloud summaries, Q&A and screenshot context require the managed service.

Direct builds use `AUDEEO_DISTRIBUTION=direct`; optional managed purchases open the website. Production builds require `AUDEEO_BILLING_ENVIRONMENT=production`. Keep sandbox for payment testing. RevenueCat's live web catalog was checked on 2026-09-22: default offering maps monthly/yearly web products at USD 8/80. The minute-packs offering also exists. No real payment was made by this verification.

## Installer

Run `npm run release:mac:direct` with Apple notarization credentials configured for Tauri. This uses Developer ID signing and the dedicated direct-distribution entitlements rather than the App Store sandbox profile. The configured identity belongs to this project owner; forks must supply their own signing identity. Notarization requires the owner's Apple credentials; do not commit them.

Verify signature, notarization/stapling, installation on a separate Mac, microphone/system audio permissions, BYOK streaming, and a sandbox web purchase with entitlement reconciliation before publishing the DMG. No public installer URL is configured yet. Update website/src/pages/Download.tsx only after a verified artifact is available.

## Website

Build: `AUDEEO_BILLING_ENVIRONMENT=production npm --prefix website run build`.
Preview: `npm --prefix website run preview`.
Set `VITE_DEMO_VIDEO_URL` to the owner's recording to replace the screenshot. It renders with playback controls and no autoplay. Website design constraints are in website/AGENTS.md.
