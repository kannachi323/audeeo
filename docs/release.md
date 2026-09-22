# Desktop release checks

Audeeo targets macOS and Windows. Use the [Mac App Store checklist](app-store-submission.md),
[macOS packaging guide](mac-app-store.md), and [direct distribution guide](direct-distribution.md)
for channel-specific configuration and signing.

Before release:

- Run the [automated checks](verification.md) and build the intended distribution.
- Verify microphone and desktop capture permissions, app selection, gain/mute,
  caption updates, spoken playback, and stop/restart on real supported machines.
- Exercise BYOK and hosted sessions, network loss, expired authentication,
  exhausted allowance, history recovery, and account switching.
- Verify overlay resizing, settings/popovers, full-screen apps, multiple monitors,
  accessibility, and long sessions. Test wired and Bluetooth audio route changes.
- Test purchases, cancellation, restoration, renewal, expiry, and usage
  synchronization in the appropriate billing sandbox.
- Verify signing, installer behavior, native SDK resources, privacy manifests,
  and launch on a machine without development files.
- Match store screenshots, reviewer instructions, privacy disclosures, and support
  links to the actual signed build and configured providers.

Builds and mocked tests do not establish physical capture behavior, store approval,
or successful production deployment. Record the OS, build ID, and results for each
release candidate.
