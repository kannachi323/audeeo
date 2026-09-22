# Desktop verification

Run application tests, the frontend build, and relay type checking:

```sh
npm run check
npm --prefix website run build
cargo build --manifest-path src-tauri/Cargo.toml
```

The Rust build compiles and links the macOS Swift package automatically. On
Windows, run the same Rust build to verify the WASAPI and Windows integration.

Database checks use an isolated disposable PostgreSQL cluster:

```sh
npm run test:database
```

Native AppKit checks require a Mac with a display. Compile each check with both
presentation sources, for example:

```sh
xcrun swiftc native/apple/Sources/AudeeoNative/MacPanel.swift native/apple/Sources/AudeeoNative/MacOverlay.swift native/apple/Tests/OverlayAppearanceChecks.swift -o /tmp/audeeo-overlay-checks
/tmp/audeeo-overlay-checks
```

Other checks in `native/apple/Tests/` cover window geometry, popovers, presentation,
and streamed caption updates. `OverlayVisualFixture.swift` is a synthetic-text
preview rather than a test of live capture.

Automated tests use mocked provider streams, authentication, and billing where
applicable. Real permissions, audio devices, long sessions, OAuth, and StoreKit
transactions need the [release checks](release.md). Historical implementation
and verification notes remain available in Git history.
