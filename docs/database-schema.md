# Database schema

The application schema has **five tables**, down from eight in the complete migration
history. Caption history is one document per completed session. The dashboard's
six-table screenshot does not show the later summary and subscription tables.

## Hosted deployment

Applied all three pending migrations to Supabase project `etbpmzwqqihnydlmibvd`
on September 15, 2026, through version `20260915203938`. The matching relay is
live at `api.audeeo.app`, Worker version `c16dae0a-8c3a-4f5d-b7f3-f81edde5646a`.

Verification preserved all 15 existing sessions and 68 caption chunks, along with
billing settings/counters, 39 usage reservations and one webhook receipt. The
hosted metadata API, account-usage RPC, anonymous-access denials and relay health
passed. All five tables have RLS enabled. Hosted advisors reported only the Auth
setting warning for disabled leaked-password protection, with no schema findings.

Local before/after data snapshots are in the ignored `artifacts/database-backups/`
directory. Older desktop binaries still need updating to use the document API.

## Table map

| Table | Replaces | Purpose |
| --- | --- | --- |
| `caption_sessions` | `sessions` + `segments` + `session_summaries` | One session row: transcript and optional summary JSON, plus searchable metadata |
| `billing_accounts` | `allowances` + `billing_subscriptions` | One user's allowance counters and optional verified subscription identity |
| `billing_settings` | `commercial_config` | Shared product settings and allowance limits |
| `usage_reservations` | `usage_ledger` | Speech usage and keys preventing duplicate charges |
| `billing_webhook_events` | `billing_events` | Successfully processed RevenueCat webhook IDs |

## Session document

`caption_sessions` contains:

- `id`, `owner_id`, `started_at`, `updated_at`, `deleted_at`.
- `source_language`, `target_language`.
- `transcript`: a JSONB array containing ordered caption chunks with source text,
  translations, timing, state and revision. These are values inside one document,
  not separate database rows.
- `summary`: optional JSONB containing generated content, language, model and source hashes.
- `segment_count`, `duration_ms`, `preview`, `summary_title`: inexpensive list metadata.
- `transcript_version`: source-content version used to prevent saving a stale summary.

The `(owner_id, started_at DESC)` B-tree index serves user history lists and the
owner foreign key; the primary key serves individual document fetches. No index
on the transcript is needed: the app does not search individual captions in SQL.

## Cross-device history, after recording ends

1. During recording, finalized captions and translation updates are saved in the
   device's local outbox. **No caption-history upload is triggered by these events.**
2. When the session finishes or the user stops it, the app marks the local document
   ready and uploads all its captions in **one RPC request per session**. There is
   no periodic upload timer. Speech delivery and billing metering continue to have
   their own network traffic, independently of history persistence.
3. Failed uploads stay local and retry on reconnect or when history is opened.
   Local drafts recovered after an interrupted app run are saved as past sessions
   when the app is no longer recording. Logging in to another device can retrieve
   only documents that have actually finished uploading.
4. The history screen fetches up to 100 rows of metadata in one indexed query.
   It loads the document on demand when opening a summary or exporting text.

`sync_caption_session` validates the payload, derives the owner from the JWT, and
creates/merges one session row under a row lock. Completed-session retries preserve
newer caption revisions and do not duplicate text. The merge is set-based and
accepts up to 10,000 caption chunks / 16 MiB of JSON per document. Local storage is
bounded and may also be limited by the platform's storage quota.

A source-content change clears the stored summary. The relay reads the document
once and saves a generated summary with a compare-and-set version, atomically
rejecting a summary if the source changed or the session was deleted during generation.

## Access and deletion

All five tables remain in `public`, with RLS and explicit grants. Owners can read
only their own session rows. Client writes use owner-checked RPCs implemented in
`private`; direct table writes are denied. Summaries are written only by the relay.
The four billing tables are accessible only to `service_role`.

Deleting history clears the transcript, summary and preview, leaving a tombstone
that prevents delayed offline uploads from recreating the session. A delete that
arrives before the first upload also creates a tombstone. Auth user deletion
cascades to history, the billing account and usage reservations.

Usage reservations deliberately have no foreign key to saved caption history:
live speech may be metered without saving history, and deleting text must not
refund usage. Webhook receipts remain independent, since they deduplicate provider
notifications rather than store caption or usage data.

## Migration and release

`20260915203938_clarify_table_names_and_merge_billing_accounts.sql` is a coordinated,
breaking schema change. Older desktop versions write separate session/segment
rows; those endpoints disappear. Do not push this migration without the matching
app and relay release.

1. Verify applied hosted migrations and test the full migration history on a staging copy.
2. Prepare the matching app/relay builds and arrange for installed clients to update.
   If clients cannot update together, a staged API transition is needed before deployment.
3. Back up the database; pause caption-history writes and relay/webhook traffic.
4. Apply the migration and deploy the app/relay. Verify metadata listing, document
   upload/read, summary generation, deletion and billing through the hosted Data API.
5. Confirm five application tables remain and check hosted security advisors.

The migration preserves the old caption and summary values inside session JSON,
retains metadata and billing counters, copies every subscription field, verifies
preservation, then drops the redundant tables in one transaction. Subscription-only
records are retained without granting new paid allowances. A five-second lock timeout
avoids waiting indefinitely for active writers.

Failures before commit roll back atomically. After commit, reverting only the app
is unsafe. Use a reviewed reverse migration that reconstructs the old tables or a
coordinated database/app restore; a restore loses writes made since the backup.

## Verification

- `npm run check`: app tests, build and relay typechecking. Outbox tests prove active
  captions cause zero uploads and 250 completed chunks upload in one request.
- `npm run test:database`: populated migration preservation, owner isolation, JSON
  validation, revision merging, concurrent writes, atomic summary version checks,
  deletion tombstones, billing accounting and account cascades in disposable Postgres.
- `AUDEEO_DATABASE_ADVISORS=1 npm run test:database`: also runs Supabase CLI 2.117.0
  advisors against that disposable cluster. Hosted Data API checks remain a release step.

References: [Supabase JSONB](https://supabase.com/docs/guides/database/json),
[Postgres JSON functions](https://www.postgresql.org/docs/current/functions-json.html).
