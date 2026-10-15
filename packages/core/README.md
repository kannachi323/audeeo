# @audeeo/core

Live transcript segments shared by Audeeo and Misty.

- `Segment`: revised in place (`revision`) until `final`; carries `speaker`,
  `channel` (`mic` | `system`) and timed `words` once final.
- `Transcript`: keeps the newest revision of each segment, never replaces a
  final one, and groups segments into speaker turns.
- `SonioxCaptions` / `sonioxConfig`: Soniox realtime tokens to segments, with
  optional speaker diarization and context.
- `OpenAICaptions`, `AudioEncoder`, `sessionConfig`: OpenAI realtime events.
- `CaptionPipeline`: serial translation that preserves spoken order.
- `DirectCaptionClient`: connects straight to a provider with a socket the
  host supplies (browser, Tauri or Node).

`npm run build` writes `dist/`. MIT licensed.
