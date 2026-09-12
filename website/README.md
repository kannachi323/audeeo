# Audeeo website

Separate Vite/React website. For Vercel, set the project root to `website`.
No backend or environment variables are required for the prepared demos.

The interactive players synchronize bundled audio and text. They do not invoke
live recognition or translation and are not benchmarks of the current app.
The application itself uses cloud recognition; playback of this website's
prepared media does not upload audio.

## Development

```sh
npm ci
npm run dev
npm run build
```

The optional media rendering scripts are documented in
[the demo asset directory](video/three-pigs/README.md).
