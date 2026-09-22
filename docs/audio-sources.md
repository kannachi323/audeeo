# Audio capture sources

Audeeo treats capture and playback as separate concerns. Capture gain changes
only the PCM frames sent to the caption model. It never changes an application's
audible volume, the system mixer, or the selected hardware output.

| Platform | Current capture scope | Select one app | Selected input gain |
| --- | --- | --- | --- |
| macOS 14.2+ | Microphone or all desktop playback or one active app, excluding Audeeo | Yes | Yes |
| Windows 10 build 20348+ / Windows 11 | Microphone or all desktop playback or one active app process tree, excluding Audeeo | Yes | Yes |
| Browser | Browser-selected microphone | No | Not implemented |

## Desktop single-input capture

macOS and Windows offer **Microphone** or **Desktop audio**, one at a time.
Desktop audio can capture all playback or one selected application. Each source
is normalized to 16 kHz mono PCM16 and forwarded immediately on its native
capture clock, without a mixing buffer or browser pacing timer.

The selected input has a gain and mute control. Mute is a gain of zero; capture
stays open for immediate unmute, so its privacy indicator remains active.
The model receives digital silence while muted and the normal silence timeout applies.

On macOS the private Core Audio process tap uses `unmuted`: the source continues
through its normal OS route while Audeeo receives a copy for the model. Audeeo
does not monitor or replay that source. On Windows, all-desktop application
loopback excludes Audeeo's process tree so translated playback cannot enter the
digital desktop channel. A selected application uses include-process-tree
loopback.

When using microphone capture with spoken translation, use headphones to avoid
recapturing the translated speech from speakers.

## Application isolation

Application isolation uses the closest public primitive on each platform:

- macOS Core Audio taps include the selected application's active process objects.
- Windows process loopback includes the selected process and its child process tree.

Applications need to be playing before desktop enumeration, and a restarted
desktop process may need to be selected again. DRM, secure media, app opt-outs,
and operating-system policy are never bypassed.

## Backlog: output routing

Selecting a hardware output for translated speech, routing translated and source
audio separately, and browser-tab-specific capture are intentionally outside the
current capture scope. They require a separate capability matrix and
physical-device qualification before being exposed.
