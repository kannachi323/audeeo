# Streaming, routing, and one-window verification — September 13, 2026

## Live OpenAI API checks

The server key in the existing local environment was used without exposing it. Input was macOS-synthesized English speech, repeated to 56.161 seconds and sent as 24 kHz mono PCM16 at real-time pace. This was direct API testing, not microphone capture or an authenticated Audeeo session.

- `gpt-live-transcribe`: both `server_vad` and `semantic_vad` rejected with `invalid_value`, parameter `session.audio.input.turn_detection`, message “Turn detection is not supported for this transcription model.”
- With `turn_detection: null`: accepted, 174 deltas, first at 726 ms, last at 57,057 ms. Exactly one commit, at 57,929 ms after input stopped. Received the final transcription completion.
- `gpt-realtime-translate`: accepted the dedicated translation configuration, 216 transcript deltas, first at 2,164 ms, last at 59,494 ms. Received 3,513,600 audio bytes. Events explicitly reported `pcm16`, `sample_rate: 24000`, `channels: 1`. Sent `session.close` at 57,814 ms and received `session.closed`; zero audio commits or conversational responses.
- Earlier 18.7-second tests also passed. These timings describe synthetic fixtures only; they are not product latency/quality benchmarks. Translation output can exceed input duration, so output playback must drain separately.

Machine-readable evidence: [OpenAI report](../artifacts/openai-streaming-verification.json). The [transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription) suggests VAD generally, but the model-specific live rejection takes precedence for this implementation. No custom pause detector or alternative model was introduced.

## Automated checks and builds

- All 69 tests across 16 TypeScript test files pass. The suite covers transcript reconciliation/history, capture resampling, measured-suffix selection, independent volume/mute commands, authenticated one-window navigation, capture preserved while Settings is open, and overlay level retained until playback drains.
- Mocked relay tests stream 60 seconds without a commit, commit once at stop, retain final corrections, forward audio during translation close, and clear lifecycle timers. Authentication/billing regression tests continue to pass; these use mocks, not live purchases.
- React production build, Worker typecheck, macOS Rust build/check, Swift package build (including the existing RevenueCat adapter), and iOS bridge compile were run successfully. No deployed service or database was modified.
- AppKit geometry checks pass: animated expansion/collapse preserves the top edge and user width, clamps to the screen, and preserves keyboard movement and a single grip.
- AppKit mode checks pass: normal level while idle; floating/Spaces behavior while active; opaque Settings remains at the active level; restoration to normal; the same window/content object throughout.
- Native playback checks submit **silent** PCM to the current output device, test drain callbacks, gain changes, bounded buffering, reset generations, and repeated cleanup. This verifies buffer consumption, not audible translation quality or the process-tap capture route.
- The development app was signed using the unchanged Apple Development identity. Its bundle ID is `com.mattdev727.audeeo`; the Keychain service remains the same. Default Mac billing SDK linkage behavior is unchanged.

## Visual checks

The explicitly labelled browser fixture uses production caption and audio-control components, without authentication or network audio. It was inspected at widths 400 and 360 with caption size 40. Both English and Mandarin retained their newest visible text within two total lines. A canvas-based wrapping mismatch was found and fixed using actual DOM layout. Native dropdowns, separate mute controls, keyboard tab navigation, and translated-volume arrow-key adjustment were exercised.

The actual signed Audeeo app was launched, but computer-use lookup resolved its name/path to the obsolete `com.matthewchen.audeeo` and rejected the running correct bundle ID. No bundle ID or credential service was changed to work around that tooling problem. Consequently this run does **not** claim a successful full native visual/audio session.

## Still requires physical qualification

- Core Audio permission grant and real-source capture; capture while source gain is zero; audible separation of the two gains; no doubled source audio or recapture of Audeeo output.
- Output-device unplug/switch, forced route failure, quit/crash, and permission revocation while capture is active. The cleanup paths and process exclusion are implemented, but were not exercised with a real tapped source.
- Actual transparent WebView overlay appearance over other apps/full-screen spaces, live Settings transitions, VoiceOver, and multiple displays.
- Audible translated speech, acoustic echo handling with microphone input (headphones recommended), long runs near provider session/context limits, and physical iOS/browser audio playback.
- No live authentication, purchase, allowance deduction, or production deployment was performed as part of these checks. Existing development-account authorization and billing paths were preserved.

Borderless panel follow-up: the single macOS window now remains borderless and resizable in both idle and active modes. Session activity controls its level, not its titlebar. The native drag grip is available on every page, alongside existing keyboard movement. A top-right Lucide Audio Lines button returns to captions without changing session state. Transparent active captions and solid Settings retain the same window/content. Automated AppKit mode and geometry checks and 80 frontend/relay tests passed; the signed desktop bundle was rebuilt. This follow-up did not repeat physical capture or live provider testing.

Rounded panel and grip follow-up: 20-point native content clipping and matching CSS rounding preserve transparent corner pixels. The top-center drag target renders Lucide GripHorizontal's original 24-point circle geometry (license in `docs/licenses/lucide.txt`). Mouse activity reveals the icon; 1.8 seconds of inactivity starts a 300 ms fade, with no fade animation under Reduce Motion. The drag target remains available while faded and stays visible during a drag. Native checks cover radius, centered/top-aligned placement, inactivity and redisplay; physical mouse dragging was not reverified. Page Back buttons were removed in favor of the existing top-right navigation icons; Escape still returns to captions.

Grip pill follow-up: a 12-point transparent top gutter puts the 24-point native grip pill halfway above and below the panel border. The pill has a rounded background, subtle outline, lighter hover fill, and open-hand/closed-hand cursor states. The original fade timing and native drag path remain. Native checks verify alignment to the new border and hover state; 80 regression tests pass. Physical pointer behavior was not manually reverified.

## Compact toolbar verification

The caption page now has only Audio Overlay and Settings in its header. Input, languages/mode, audio mix, silence protection, and Start/Stop occupy one icon-only bottom row. Descriptive labels and current values remain in popovers/tooltips; Account and History are reachable through Settings. Native PiP remains available from Overlay settings on supported devices.

Opening a control no longer requests a window resize: the invalid 650-point request was removed (the native validator accepts up to 640). Page changes use 260/500-point requests. Popovers open over captions inside the panel, scroll independently, and preserve the toolbar. Escape dismisses the menu before page navigation and restores trigger focus. Outside pointer presses dismiss it; another trigger replaces it. Source/mode/language/silence settings retain their active-session restrictions, while volume and mute remain live.

Verification: `npm run check` passes 81 tests, the frontend build, and relay typecheck. AppKit window-mode and geometry checks pass. Browser UI inspection at 400 and 360 points verified bilingual captions at size 40, scrolling language controls, error notices, audio sliders, and Escape focus restoration. The native automation tool again rejected `com.mattdev727.audeeo`, so physical edge resizing, grip dragging, and live capture/transparent-window transitions were not manually reverified. No provider or billing behavior changed; no relay deployment is required for this toolbar change.

## Popover positioning and resize flicker fix

Inspection found that popover opening had been changed to request a 640-point native window while CSS forced the visible panel to 248 points and positioned menus below it. Audio/timer menus also used unconditional right alignment. This created competing size transitions and detached-looking menus. Popovers now retain the user's window dimensions, use the panel as their containing block, and position above their triggering button with horizontal bounds. Nested Radix selects use collision detection against the panel instead of overflowing below it.

Page resizing skips identical frames and live user resizes and uses NSWindow's frame transition instead of queued animator-proxy updates. Caption measurement now reacts only to width changes, batches work per animation frame, and isolates its hidden measurement probe from viewport overflow.

Verification: 85 tests, frontend build, relay typecheck, AppKit geometry checks, and signed build passed. Browser inspection verified the timer and nested language menu remain within the 400-point panel, with captions preserved. The native physical flicker symptom was not manually reproduced/verified with computer automation; existing app-attachment limitations remain. No provider settings, language lists, or audio lifecycle changes were made.

## Explicit borderless resizing and bottom controls

Controls now occupy a bottom drawer inside the same window. `set_controls_open` is driven by open/closed state, not which control is selected. Native code adds up to 220 points once, preserving the current top edge when screen space permits; closing removes only the added space. The toolbar and subtitle area remain above the drawer, and drawer contents scroll. A screen-height limit can reduce available space. Switching controls does not produce another native resize.

The native `.resizable` borderless behavior was replaced with an explicit perimeter view, handling all eight edges/corners with minimum sizes and screen limits. Resizing uses direct nonanimated frames, preserves the opposite edge, and cannot collapse to negative sizes. Diagonal cursors and nearly transparent corner hit surfaces keep the corners interactive. The native WebView host is no longer relayered or corner-masked; CSS owns the visible rounded panel. Native automated checks cover all resize directions, opposite-edge preservation, perimeter/interior hit testing, idempotent drawer opening, and restoration. 87 frontend/relay tests and the signed build pass. Physical WindowServer resizing/disappearance remains unverified through UI automation; do not treat these checks as a live reproduction of that symptom.

## External dropdown correction

The bottom drawer and its native window-expansion command were removed. On macOS, each control opens a temporary owned WebviewWindow below its toolbar button, outside the main window. Position is bounded to the monitor work area, falling above only when there is insufficient space below. The popup has no taskbar entry or resize controls. It loads only the controls entrypoint, not App/auth/session initialization. Only control values and changes are exchanged with the main window; capture and playback remain owned by the main app. Blur, Escape, parent movement/resizing, navigation, and unmount dismiss the popup. Browser previews use a downward DOM popover without changing panel dimensions.

89 automated tests and the signed build pass, including popup anchoring, monitor bounds, state updates, active-session restrictions, and disposal. AppKit geometry checks pass. External native popup interaction has not been manually verified through the app-attachment tool. An incomplete native resize-rendering method was also completed with frame coalescing and final-frame flush so the current native sources compile.

## Native resizing and preloaded dropdown host

Removed the custom perimeter view, mouse-driven frame calculations, timer, and manual WebKit live-resize callbacks. The main NSWindow now uses AppKit's titled/resizable/full-size-content style with its title, separator, and standard buttons hidden. It retains the panel appearance and native grip while AppKit owns edge dragging. Native geometry checks hold the opposite edge fixed through a 100-step left-edge sequence; visible live resize remains unverified because the computer-use tool still rejects the correct bundle ID.

A single hidden `controls-popup` WebView now preloads at toolbar startup. Opening controls repositions and updates that host; closing hides it instead of destroying it. Reopening the same control uses a presentation token to show/focus it again. Old dismiss events and cancelled opens cannot revive an obsolete presentation. A z-index only stacks within a WebView; this reusable owned window is what permits drawing outside the main window without changing the main frame. 88 automated tests, native geometry/mode checks, and signed build pass. No claim is made that physical jitter or first-click latency has been measured on the user's running app.
