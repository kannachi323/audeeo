# Session intelligence

Saved sessions expose an on-demand analysis dialog. The client sends only the session ID, output language, an ephemeral instruction and an optional in-memory OpenAI key. The relay verifies identity and ownership, fetches finalized source segments directly from Supabase, and never accepts transcript text from the client.

`gpt-5.6-luna` runs with low reasoning, strict JSON Schema output, a bounded output budget and `store: false`. A personal OpenAI key bypasses Audeeo allowance. Otherwise the relay refreshes the RevenueCat entitlement before using the server key. Provider errors are reduced to credential-free messages.

The saved record contains one replaceable structured analysis per session. A source hash prevents stale writes and segment changes invalidate the record. RLS grants authenticated owners select/delete only; relay service credentials own insert/update. Quotations and Q&A citations are retained only when they exactly match a canonical source segment, and their timestamps are assigned server-side. Q&A messages remain client-local and disappear when the dialog closes.

## Context from the screen

The desktop Context popover has a **Fill from screen** button. One click captures the entire main display and automatically sends it to OpenAI to fill category, background, names/terms and preferred translations. Audeeo hides its own window and popover for the capture, restores the window on success or failure, then reopens Context with a pending state. Existing context remains intact if capture or generation fails; generated fields remain editable after success.

macOS uses the system screenshot utility after checking Screen & System Audio Recording access. Windows uses the built-in Windows PowerShell/.NET screen capture APIs without opening a console. macOS temporary images live in a private temporary directory that is removed after capture; Windows holds the image in memory. The client scales the image to at most 2560 pixels on its longest edge and encodes JPEG. Images are never stored with context/settings/history. Only the generated context uses the existing local context storage.

The authenticated `/v1/context/from-screenshot` route checks the request size while streaming, accepts PNG/JPEG/WebP data URLs up to 4 MiB, validates the file signature, and uses the same server-owned subscription/pack authorization as session summaries. The Responses API receives an `input_image` with high detail, strict Structured Outputs and `store: false`. Screenshot content is explicitly treated as untrusted reference material, with no web search or instructions taken from visible text. Images with no readable useful context return an error. The legacy from-link relay endpoint remains for older clients.

The screenshot itself goes through the relay to OpenAI. Capture is a single explicit action, not continuous monitoring. Only the primary display is captured on multi-monitor setups. Automatic capture is currently desktop-only.

## Refill from session

The Context popover includes a **Refill from session** dropdown. Opening Context fetches every non-deleted session from the signed-in account’s History in stable, paginated order. Entries use the same title (or date fallback) as History. Sessions without a usable local context snapshot are shown as **Title (blank)** and disabled; they are never omitted. Loading, fetch errors and genuinely empty History have distinct menu states. A saved session’s first finalized caption archives its nonempty starting context. Selecting a session restores category, background and names/terms; preferred translation pairs are restored only when both source and target match the current session. This is a local restore and does not call an LLM.

The latest 30 snapshots are retained in the existing private context store, filtered by the signed-in account. Clearing the active fields at session end preserves these snapshots for explicit reuse. Sessions recorded with text history disabled are not archived, and deleting a session or account also removes its local context snapshots. Sessions predating this feature have no snapshot and appear as disabled blank entries. Snapshots are local to this device and are not synchronized across devices. The dropdown uses native menus in detached desktop controls and the existing custom select elsewhere.

## Session saving and retention

History uses the account's **Save sessions** setting. Enabling it requires acknowledging the 30-day retention policy. Disabling it requires confirmation, then atomically disables uploads and removes all saved transcript, summary, and preview content. The client also clears its offline history and reusable context. History uses one active row for pointer hover, keyboard focus, or a touch tap. Only that row mounts its three action buttons; leaving, scrolling, or focusing outside clears them.

`session_history_settings` holds the account preference and a monotonic upload generation. Each toggle increments the generation; the relay stamps captions with the generation and session start time. Completed uploads lock the same preference row as the off toggle, and stale generations are discarded. Re-enabling saving cannot replay old offline sessions. Context snapshots and offline outboxes are pruned by age and generation when synchronizing; an offline device applies account changes when it reconnects.

`caption_sessions` records creation, completion/upload, fixed expiry, deletion reason, and lifecycle state (`saved`, `expired`, `deleted`). Expiry is 30 days from session start and cannot be extended by retries or summaries. Owner reads and summary requests exclude expired sessions immediately. The partial `(expires_at, id)` index contains live sessions only. The `audeeo-expire-sessions` pg_cron job runs at **00:00 UTC** (server time) and clears expired content in batches. Minimal empty tombstones remain to prevent deleted session IDs from being uploaded again; they contain no captions, summaries, or preview text. Billing records have a separate lifecycle.

Validation: `npm test`, `python3 scripts/test-database.py`, and optionally `AUDEEO_DATABASE_ADVISORS=1 python3 scripts/test-database.py`. The database suite uses an isolated local cluster and covers preference persistence, owner isolation, expiry, concurrent toggle/upload races, and replay protection. Visual fixture: `/tests/fixtures/history.html`.
