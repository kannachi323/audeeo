# Supabase integration

Audeeo uses project `etbpmzwqqihnydlmibvd` with Google, Apple, and email/password sign-in. Email confirmation is required for new password accounts; magic-link/OTP and anonymous sign-in are not used. Enable the Email provider, email signups, and Confirm Email in the hosted Supabase dashboard. Configure production SMTP before release.

## App configuration

The root `.env` supplies `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY`. Only the URL and publishable key enter the app bundle. Configure the secret key separately in the deployed relay. Restart Vite and the relay after changing `.env`.

The Supabase redirect allowlist includes:

- `audeeo://auth/callback` for email confirmation and desktop fallback links.
- `http://127.0.0.1:*/auth/callback` for macOS and Windows' short-lived, random-port loopback callback.
- `http://localhost:1420` and `http://127.0.0.1:1420` for browser development.

Add the deployed app's exact URL before shipping a browser build, and set `AUTH_REDIRECT_URL` to it. OAuth uses PKCE. macOS and Windows open the default system browser and listen on a random localhost port for up to five minutes. The loopback response gives the browser a real completion page, passes the one-time code to the running Audeeo instance, and avoids leaving Google on a loading page after a custom-protocol handoff. The registered `audeeo://` scheme remains available for email confirmation, fallback links. Native session storage uses the existing platform storage commands; browser sessions use the Supabase client storage. A session refresh/sign-in event starts history synchronization outside the Supabase auth callback lock.

## Provider credentials

Enable providers in [Audeeo's Supabase Auth settings](https://supabase.com/dashboard/project/etbpmzwqqihnydlmibvd/auth/providers). Credentials remain in the dashboard; `config push` deliberately omits provider credentials and enablement to preserve dashboard changes.

For **Google**, create a Web application OAuth client, configure consent and any test users, and register this authorized redirect URI:

`https://etbpmzwqqihnydlmibvd.supabase.co/auth/v1/callback`

Enter its client ID and client secret in Supabase and enable Google. See [Supabase's Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

For **Apple**, enable Sign in with Apple on the App ID and create a Services ID for this OAuth flow. Configure the domain `etbpmzwqqihnydlmibvd.supabase.co` and the same HTTPS callback above. Enter the Services ID first in Supabase's client IDs and add the Apple client secret generated from your signing key. Apple OAuth client secrets need renewal at least every six months. See [Supabase's Apple setup](https://supabase.com/docs/guides/auth/social-login/auth-apple).

The HTTPS callback belongs in Google/Apple's consoles; `audeeo://auth/callback` belongs in Supabase's redirect allowlist.

## Postgres and RLS

See [Database schema](database-schema.md) for the table map, consolidation rationale, and coordinated release procedure.

- `caption_sessions` stores the transcript and summary as JSONB in one owner-scoped session row. The app saves locally while recording and uploads the completed session document once.
- `billing_settings`, `billing_accounts`, `usage_reservations`, and `billing_webhook_events` have RLS enabled and no client grants. Only the relay's secret key can access them.
- `billing_settings.monthly_seconds` is the included allowance granted to an active RevenueCat entitlement. The current migration initializes an otherwise-unconfigured plan to 600 minutes per monthly period while preserving an existing nonzero operator value. The two operator emails in the unlimited-usage migration are checked against verified Auth records and produce non-billable ledger rows.
- Clients read their own sessions and upload completed documents through an owner-checked RPC; direct table writes are denied. Session deletion uses an owner-checked RPC that leaves a tombstone and removes text, preventing offline writes from recreating deleted history.
- Privileged tombstone implementation lives in the unexposed `private` schema. Metering and entitlement RPCs are restricted to `service_role` and run as the invoker.
- Deleting an Auth user cascades to their history, billing account, and usage reservations.

Apply all migrations in order with `supabase db push` only after completing the coordinated release preparation described in the schema guide. The table-name migration breaks older desktop history clients. Use Supabase CLI 2.117.0 or newer for `config diff`/`config push`; the declared-property behavior preserves omitted remote settings. Always review `config diff` before pushing.

## Verification

`npm run check` runs unit/UI tests, the app build, and relay typechecking. `npm run test:database` applies every migration to a disposable local Postgres cluster and tests document preservation, owner isolation, forbidden writes and RPCs, concurrent JSON merges and usage accounting, summary version checks, tombstones, and account deletion.

Hosted integration checks exercised real user JWTs against the Data API and removed their temporary accounts and rows afterward. Full Google/Apple sign-in still requires configured provider credentials and a real provider-account test. Speech-provider and billing configuration are separate from authentication.

Native OAuth changes require restarting `npm run desktop`; a Vite page reload cannot replace native code. No additional Supabase or Google redirect URI is needed. See [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/) and [Apple authentication sessions](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession).
