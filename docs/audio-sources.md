# Audio capture sources and model-input mixing

Audeeo treats capture and playback as separate concerns. Capture gain changes
only the PCM frames sent to the caption model. It never changes an application's
audible volume, the system mixer, or the selected hardware output.

| Platform | Current capture scope | Select one app | Independent microphone / playback model-input gain |
| --- | --- | --- | --- |
| macOS 14.2+ | Microphone plus all desktop playback or one active app, excluding Audeeo | Yes | Yes |
| Windows 10 build 20348+ / Windows 11 | Microphone plus all desktop playback or one active app process tree, excluding Audeeo | Yes | Yes |
| Android 10+ | MediaProjection playback across allowed apps or one selected app UID; microphone remains a separate mode | Yes | Not implemented |
| iOS 27+ | Full-display playback approved in Apple's ScreenCaptureKit picker or microphone | System picker only | Not implemented |
| Browser | Browser-selected microphone | No | Not implemented |

## Desktop model-input mixer

macOS and Windows offer **Microphone + desktop audio** alongside the two
single-input fallbacks. Each captured channel is normalized to 16 kHz mono
PCM16. The desktop mixer briefly prebuffers the independently clocked streams,
then emits one 20 ms frame at a time. It applies microphone and desktop gains,
uses zero samples for a temporary underrun, limits summed peaks before PCM16
conversion, and bounds each input queue to one second.

Mute is a gain of zero. Capture stays open for immediate unmute, so microphone
and screen/audio privacy indicators remain active. If both inputs are muted,
the model receives digital silence and the normal silence timeout applies.

On macOS the private Core Audio process tap uses `unmuted`: the source continues
through its normal OS route while Audeeo receives a copy for the model. Audeeo
does not monitor or replay that source. On Windows, all-desktop application
loopback excludes Audeeo's process tree so translated playback cannot enter the
digital desktop channel. A selected application uses include-process-tree
loopback.

Speakers can still enter the microphone acoustically and duplicate desktop
audio after a short room delay. The native desktop mixer does not yet claim
verified acoustic echo cancellation, so physical headphone and echo tests
remain required.

## Application isolation

Application isolation uses the closest public primitive on each platform:

- macOS Core Audio taps include the selected application's active process objects.
- Windows process loopback includes the selected process and its child process tree.
- Android playback capture matches the selected application UID, subject to
  MediaProjection consent and every source application's playback-capture policy.
- iOS uses Apple's full-display content-sharing picker and does not attempt to
  enumerate installed applications itself.

Applications need to be playing before desktop enumeration, and a restarted
desktop process may need to be selected again. DRM, secure media, app opt-outs,
and operating-system policy are never bypassed.

## Backlog: output routing

Selecting a hardware output for translated speech, routing translated and source
audio separately, and browser-tab-specific capture are intentionally outside the
desktop input-mixer milestone. They require a separate capability matrix and
physical-device qualification before being exposed.
