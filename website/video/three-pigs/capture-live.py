#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
AUDIO = HERE / "three-pigs-narration.wav"
EVENTS = HERE / "live-events.json"
RAW_LOG = HERE / "live-run.log"


def main() -> None:
    command = [
        str(ROOT / "build/full/audeeo-cli"),
        "live",
        "--duration",
        "38",
        "--output",
        str(HERE / "audeeo-live.en.vtt"),
        "--model",
        str(ROOT / "models/ggml-small-q5_1.bin"),
        "--source",
        "zh",
        "--target",
        "en",
    ]

    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None

    audio_process: subprocess.Popen[str] | None = None
    audio_start: float | None = None
    pending: dict[str, object] | None = None
    events: list[dict[str, object]] = []
    log_lines: list[str] = []

    def flush_pending() -> None:
        nonlocal pending
        if pending is not None:
            pending["text"] = " ".join(str(pending["text"]).split())
            events.append(pending)
            pending = None

    for raw_line in process.stdout:
        line = raw_line.rstrip()
        log_lines.append(line)

        if audio_start is None and "compute buffer (decode)" in line:
            time.sleep(1.0)
            audio_start = time.monotonic()
            audio_process = subprocess.Popen(["afplay", str(AUDIO)])

        kind = None
        text = ""
        if line.startswith("[partial] "):
            kind = "partial"
            text = line.removeprefix("[partial] ")
        elif line.startswith("[final] "):
            kind = "final"
            text = line.removeprefix("[final] ")

        if kind is not None:
            flush_pending()
            relative = 0.0 if audio_start is None else time.monotonic() - audio_start
            pending = {"time": round(relative, 3), "kind": kind, "text": text}
        elif pending is not None and line and not line.startswith(("{", "  \"", "}", "ggml_")):
            pending["text"] = f"{pending['text']} {line}"

    flush_pending()
    exit_code = process.wait()
    if audio_process is not None:
        audio_process.wait()
    if exit_code != 0:
        raise SystemExit(exit_code)

    filtered = [event for event in events if 0 <= float(event["time"]) <= 31.0]
    payload = {
        "audio": AUDIO.name,
        "duration": 30.304,
        "events": filtered,
    }
    EVENTS.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    RAW_LOG.write_text("\n".join(log_lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
