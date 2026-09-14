# Keychain responsiveness fix — September 13, 2026

The native `auth_storage_get` and `auth_storage_set` Tauri commands were synchronous and called blocking Security APIs directly. Supabase session checks repeatedly requested storage, including while syncing history. Reads also returned `null` for every Keychain error, incorrectly treating denied/locked access as a missing credential.

Both commands now dispatch their entire operation, including cache-lock acquisition, through Tauri's blocking-worker pool. A serialized, process-local cache prevents concurrent/repeated session reads and redundant writes from returning to Keychain. Successful removal clears the cached token; failed writes are reported rather than represented as durable success. Denied reads remain errors and are cached until explicit Retry Keychain. The cache never writes credentials to disk outside Keychain.

Queries disallow interactive authentication using `LAContext.interactionNotAllowed` and retain `kSecUseAuthenticationUIFail` for compatibility with existing legacy macOS items. Background session checks do not initiate consent dialogs. A locked or inaccessible item produces an in-app error; Retry Keychain clears only failed cache entries and reloads the sign-in UI. It does not change item access controls, delete credentials, or bypass authorization. The first credential load still waits asynchronously for Security to return; the main UI thread does not wait.

The service and bundle identifier remain `com.mattdev727.audeeo`. Apple signing identity and authentication/billing authorization logic remain unchanged. The existing process must be quit and reopened to load the rebuilt executable; rebuilding alone cannot change the old process's blocked Keychain call.

Verification:

- Four Rust cache tests pass: read/write deduplication, concurrent callers, missing versus denied results, failed writes, explicit retry, account separation, and deletion.
- A native Swift test performed real noninteractive create/read/update/delete operations on one UUID-named synthetic item under the same service, on a background queue. The test removed its own item. No user credentials were read or modified.
- The same test asserts noninteractive query flags; native entry points assert they are not executing on the main thread.
- All 69 existing TypeScript tests, frontend build, Worker typecheck, and signed macOS build pass.
- The user's particular denied/locked item was not accessed by the test, so recovery of that item's authorization is not claimed.

References: [Apple: SecItemCopyMatching](https://developer.apple.com/documentation/security/secitemcopymatching(_:_:)), [Apple: noninteractive authentication](https://developer.apple.com/documentation/localauthentication/lacontext/interactionnotallowed), [Supabase: custom auth storage](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
