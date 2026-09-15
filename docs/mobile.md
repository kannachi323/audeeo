# Mobile architecture

Audeeo's mobile UI remains the existing React/Tauri application. Native code owns the capabilities that must continue while the WebView is backgrounded: authorized playback capture, the realtime relay connection, and floating caption presentation.

## Shared contract

The frontend uses capability names rather than OS API names:

- `systemAudio` means the OS can request playback capture.
- `applicationAudio` means the user can isolate one selected application. It is
  available on macOS, Windows, and Android where native process or UID filters
  are available. iOS delegates all permitted selection to Apple's system picker.
- `inputMix` means Audeeo can combine microphone and playback PCM with
  independent model-input gains. It is currently implemented only on macOS and
  Windows; mobile retains the existing single-input session.
- `translatedPlayback` means the client can render spoken translation returned
  by the relay. It is available on every supported desktop and mobile target.
- `nativeSession` means native code owns capture and the realtime connection.
- `nativePip` means a native floating-caption presenter is available. On iOS this is Picture in Picture; on Android this is an application overlay.
- Realtime input is normalized to mono PCM16 at 16 kHz before upload.
- The mobile state reducer exposes permission, capture startup, model connection, waiting-for-audio, audio-detected, translating, stopping, and typed error states.

Captured audio and model events remain provider-agnostic. The native implementations speak the existing `/v1/realtime` protocol, so Soniox, OpenAI Realtime, and future relay-backed providers do not leak into capture or presentation code.

## Android

The generated Tauri Android app targets SDK 36 and has a minimum API level of 29 (Android 10), the first release with `AudioPlaybackCaptureConfiguration`.

`MobileLivePlugin` requests runtime audio permission and launches the system MediaProjection consent UI. Once approved, `PlaybackCaptureService` immediately becomes a `mediaProjection` foreground service with a persistent notification. The service owns:

- the single-use MediaProjection token and revocation callback;
- an `AudioRecord` configured for permitted media, game, and unknown playback usages;
- 100 ms, 16 kHz mono PCM16 chunks;
- the existing realtime WebSocket session;
- a bounded 24 kHz mono PCM16 `AudioTrack` for spoken translation, using a
  non-capturable speech usage so translated output cannot loop back into input;
- a 128 KB maximum queued WebSocket payload, after which the session fails rather than increasing latency without bound;
- silence/capture status events; and
- an optional draggable `TYPE_APPLICATION_OVERLAY` caption panel.

The overlay permission is requested only after the user explicitly chooses **Show floating captions**. Capture does not silently request it. Stopping the session releases `AudioRecord`, MediaProjection, the socket, foreground notification, and overlay.

Android sign-in opens the system browser and returns through the existing `audeeo://auth/callback` flow. Account tokens and saved translation context are encrypted with an Android Keystore AES-GCM key before being stored in app-private preferences.

Playback capture is not universal. A source must use a capturable media/game/unknown audio usage, allow playback capture, run in the same Android user profile, and expose non-protected content. Audeeo does not and must not bypass Widevine, secure surfaces, application opt-outs, or device policy. Android does not reliably distinguish silence from every policy/protection case, so after eight seconds the UI says the source may be silent, protected, or opted out.

The Android source picker lists launchable applications and narrows playback
capture with an `AudioPlaybackCaptureConfiguration` UID filter. Selected apps
must still satisfy Android's capture-policy rules.
MediaProjection does not give Audeeo control of a source app's playback volume,
so the source app still owns exact original volume. Audeeo controls translated
volume independently and requests transient ducking only while translated speech
is audible. Muting translated output gives original-only playback; Android does
not expose a public route that lets Audeeo mute another app while continuing to
capture it for a translation-only mix.

Android 14+ requires the `FOREGROUND_SERVICE_MEDIA_PROJECTION` permission and service type declared in the manifest. Android 15 shows a prominent projection status chip and ends projection when the device locks. The session starts only from a visible, user-initiated Audeeo action; it is never restarted from boot or a background receiver.

## iOS

The repository deployment target is iOS 27. Its native session owns either ScreenCaptureKit device-playback capture or optional microphone capture, the realtime WebSocket, bounded pending audio, and an `AVPictureInPictureController` backed by `AVSampleBufferDisplayLayer`. Caption frames use the same dark, opaque, two-line visual treatment as the desktop overlay. Device playback is the default input; PiP is started only from an explicit user action.

Audeeo presents `SCContentSharingPicker.shared`, starts an `SCStream` from the returned full-display filter, requests 16 kHz mono system audio, and excludes Audeeo's own translated playback from capture. The `screen-capture` background mode keeps the stream alive while another app is frontmost. Audeeo intentionally has no legacy broadcast extension or fallback for iOS 26 and earlier. Protected and non-shareable content remains unavailable.

iOS has no supported general always-on-top transparent window. Audeeo uses public PiP APIs and an opaque caption surface; it does not use private windows, SpringBoard access, undocumented entitlements, or DRM workarounds.

## Device verification

Automated builds prove the shared frontend and Android package compile, but mobile capture must also be verified on physical devices:

1. Start a session from the foreground and approve only the requested OS permissions.
2. Open a capturable media app and verify partial captions update while Audeeo is backgrounded.
3. Confirm Android shows the foreground notification and projection chip.
4. Revoke projection, lock the screen, change audio route, disconnect the network, and stop from Audeeo; each path must release capture and present a useful state.
5. Test source opt-out and protected content without expecting or attempting capture.
6. Test the Android overlay permission-denied path and drag behavior.
7. Verify Android translated speech plays while the source app is foreground,
   temporarily ducks the original, follows the translated-volume control, never
   re-enters capture, and drains the final phrase before stopping.
8. On an iOS 27 device, verify the ScreenCaptureKit picker, playback capture, PiP start/stop, background updates, return-to-app restoration, and interruptions.

## Primary platform references

- Apple: <https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios>
- Apple PiP: <https://developer.apple.com/documentation/avkit/avpictureinpicturecontroller>
- Android playback capture: <https://developer.android.com/media/platform/av-capture>
- Android MediaProjection: <https://developer.android.com/media/grow/media-projection>
- Android 15 behavior changes: <https://developer.android.com/about/versions/15/behavior-changes-all>
