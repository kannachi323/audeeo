<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Audeeo icon" width="88" height="88" />
  <h1>Audeeo</h1>
  <p>Live captions and translation.</p>
  <p>Open source. Bring your own API key or subscribe.</p>
  <p>macOS · Windows</p>
  <p>
    <a href="#build-from-source">Build from source</a> ·
    <a href="https://github.com/kannachi323/audeeo/issues">Issues</a> ·
    <a href="https://audeeo.app/support">Support</a> ·
    <a href="LICENSE">MIT license</a>
  </p>
</div>

## The app

- Live captions from your microphone or app audio.
- Original speech and translated text in a floating caption window.
- Spoken translation, with separate playback controls.
- Session history, summaries, and questions about saved transcripts.

Capture support varies by platform. See [audio sources](docs/audio-sources.md).

**In development.** No public installers yet.

## Build from source

Requires Node.js 24+, Rust, and the native build tools for your target platform.

```sh
git clone https://github.com/kannachi323/audeeo.git
cd audeeo
npm ci
cp .env.example .env
```

Fill in your local configuration, then launch the desktop app:

```sh
npm run desktop
```

Use `npm run dev` for the browser UI. Native audio capture requires the app.
Native signing must use your own credentials.

### Backend development and checks

Install the relay dependencies:

```sh
npm --prefix services/session-relay ci
```

For a local relay, set `RELAY_URL=http://127.0.0.1:8787` in `.env` and run this in a separate terminal:

```sh
npm --prefix services/session-relay run dev
```

See [backend setup](docs/supabase.md) for account and database configuration.

```sh
npm run check
npm run test:database
```

## Repository

| Folder | Purpose |
| --- | --- |
| `src/` | React interface and desktop session controls |
| `src-tauri/` | Rust desktop shell, Windows audio, and system integration |
| `native/apple/` | Swift macOS audio, windows, and App Store billing |
| `shared/` | Shared TypeScript types and session logic |
| `services/session-relay/` | Hosted captions, translation, and billing backend |
| `website/` | Website and web checkout |
| `tests/`, `scripts/`, `docs/` | Checks, build tools, and development notes |

## Contributing

Bug reports and pull requests are welcome. Include your platform and reproduction steps with an issue; keep changes focused and run the relevant checks before opening a pull request.

## License

[MIT](LICENSE) © 2026 Matthew Chen.

[Privacy](https://audeeo.app/privacy) · [Terms](https://audeeo.app/terms) · [Support](https://audeeo.app/support)
