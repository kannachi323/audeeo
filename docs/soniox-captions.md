# Soniox backend

Soniox is a separate caption backend implemented in `services/session-relay/src/soniox.ts`, using the official `@soniox/node` SDK (2.3.0). It runs inside the existing authenticated Cloudflare relay with the same input limits, usage reservations, silence protection and stop/drain protocol. No provider key is bundled into the app. Cloudflare's `nodejs_compat` flag supports the SDK's Node imports.

## Local use

Set these root `.env` entries:

```dotenv
RELAY_URL=http://127.0.0.1:8787
CAPTION_PROVIDER=soniox
SONIOX_API_KEY=your-key
SONIOX_MODEL=stt-rt-v5
```

Start the relay with `npm --prefix services/session-relay run dev`, then start/restart the development app with `npm run desktop` (or `npm run dev` for the browser). The relay reads the root `.env`; the app reads `RELAY_URL` at build/dev-server startup. An already installed release build retains its compiled relay URL.

Audeeo-funded subscriptions use Soniox by default. Set `CAPTION_PROVIDER=openai` and restart the relay only when deliberately changing the funded provider. Users can override the funded default for an individual session from Settings → Providers by supplying their own OpenAI or Soniox key. Explicit WebSocket routes `/v1/realtime/soniox` and `/v1/realtime/openai` remain available for test clients; `/v1/realtime` uses either the validated personal-key selection or the server setting. Each route requires only its own provider key, plus the existing account configuration.

This local configuration does not deploy anything. Production uses Cloudflare secrets/bindings, not the root `.env`. A production app build must use its production `RELAY_URL`.

## Behavior

- Native 16 kHz mono PCM16 is sent directly through the SDK; no GPT resampling is used.
- Matching source/target languages enable transcription. Different languages enable one-way translated captions, including automatic source detection.
- The leftmost Context icon in the caption toolbar opens a compact popover and stores one local configuration for the next session. Category, background text, names/terms and preferred source/target mappings are validated against a combined 10,000-character limit and sent through Soniox structured context. Context is not logged or synchronized.
- Final tokens append once; provisional tokens replace the previous draft. Source and translation tokens are handled independently because translation can arrive later. Segment boundaries are buffering boundaries, not a guarantee of sentence-by-sentence alignment.
- Endpoint events and bounded text chunks commit confirmed text to the app's existing history flow. Unconfirmed drafts are discarded when closing; they are never promoted into saved final text.
- Stop waits for Soniox's final results, with a 15-second relay timeout. Provider failures are surfaced without forwarding raw SDK error payloads.
- This adapter produces text captions only. Soniox spoken translation requires a separate TTS connection and is not wired here. The GPT backend still has its existing audio output.
- The app retains its existing language menu. Common aliases are normalized (`cmn`/`zh-cn`/`zh-tw` → `zh`, `nb`/`nn` → `no`, `fil` → `tl`); unsupported Soniox model/language combinations fail visibly. The full menu has not been live-validated against Soniox.

## Repeatable live test

Use a synthetic, mono 16 kHz little-endian PCM16 fixture, at most 30 seconds:

```sh
say -o /tmp/soniox-test.aiff 'Hello, this is a test of live captions. The train leaves tomorrow morning at nine. Please bring your ticket and a small bag.'
ffmpeg -y -i /tmp/soniox-test.aiff -ar 16000 -ac 1 -f s16le /tmp/soniox-test.pcm
npm run test:soniox -- /tmp/soniox-test.pcm
```

The test uses the actual backend adapter and your Soniox key. It streams the fixture twice (English transcription, then English-to-Chinese translation), checks that captions arrive before Stop and that final text is returned, and writes a credential-free report to `artifacts/soniox-streaming-verification.json`. This incurs normal provider usage. Ordinary `npm test` uses mocked transport and makes no provider calls.

For a controlled context comparison, supply religious and philosophy PCM fixtures to `npm run benchmark:soniox-context -- religious.pcm philosophy.pcm`. The four short provider sessions compare context off/on and save credential-free term-hit results to `artifacts/soniox-context-benchmark.json`. Term-hit counts are a narrow regression signal, not a general translation-quality score.

References: [Soniox Node SDK](https://soniox.com/docs/sdk/node-SDK), [WebSocket protocol](https://soniox.com/docs/api-reference/stt/websocket-api), [Cloudflare outbound WebSockets](https://developers.cloudflare.com/workers/examples/websockets/).
