# App icon assets

The supplied `assets/audeeo-logo.png` is retained unchanged. Run `python3 scripts/generate-icons.py` to package it using Tauri's icon tooling.

The legacy macOS ICNS uses a 1024-point canvas, an 824-point dark rounded tile centered with 100-point transparent margins, and the original logo proportionally placed inside. This replaces the previous nearly full-canvas tile. The script copies only desktop icons from Tauri’s temporary output and refreshes the browser favicon. Bundle identity and signing are unchanged.

Reference: [Apple app-icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons). This project continues to package ICNS for its existing macOS deployment target; it does not introduce an Icon Composer migration.

Verified generated image appearance and signed bundle build. The running Dock icon may remain cached until the old app exits and the rebuilt app is opened; no system icon cache was reset.
