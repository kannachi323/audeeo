# Session intelligence

Saved sessions expose an on-demand analysis dialog. The client sends only the session ID, output language, an ephemeral instruction and an optional in-memory OpenAI key. The relay verifies identity and ownership, fetches finalized source segments directly from Supabase, and never accepts transcript text from the client.

`gpt-5.6-luna` runs with low reasoning, strict JSON Schema output, a bounded output budget and `store: false`. A personal OpenAI key bypasses Audeeo allowance. Otherwise the relay refreshes the RevenueCat entitlement before using the server key. Provider errors are reduced to credential-free messages.

The saved record contains one replaceable structured analysis per session. A source hash prevents stale writes and segment changes invalidate the record. RLS grants authenticated owners select/delete only; relay service credentials own insert/update. Quotations and Q&A citations are retained only when they exactly match a canonical source segment, and their timestamps are assigned server-side. Q&A messages remain client-local and disappear when the dialog closes.

## Context from a link

The Context popover accepts a YouTube or other public HTTP(S) link and generates an editable context draft. The authenticated relay uses the same OpenAI BYOK/subscription authorization path and calls `gpt-5.6-luna` with Web Search, strict Structured Outputs and `store: false`. Audeeo does not fetch the pasted host directly. Page contents are explicitly treated as untrusted reference material, local/private-style URLs are rejected, and the link is not persisted with the resulting context.

For YouTube, the model uses public titles, descriptions, chapters and accessible captions. Other pages use accessible text and metadata. Audeeo does not claim that the model watched or listened to a video; a page without useful public information returns an unavailable error.
