#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1920
HEIGHT = 360
FPS = 30
WHITE = (255, 255, 255, 255)
MUTED = (217, 216, 209, 255)
QUIET = (157, 156, 149, 255)
ACCENT = (120, 215, 164, 255)

ROOT = Path(__file__).resolve().parent
CAPTIONS = json.loads((ROOT / "captions.json").read_text(encoding="utf-8"))
LIVE = json.loads((ROOT / "live-events.json").read_text(encoding="utf-8"))
OUTPUT = ROOT / "work" / "caption-track.mov"

LATIN = "/System/Library/Fonts/Supplemental/Arial.ttf"
LATIN_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
CJK = "/System/Library/Fonts/Supplement/Arial Unicode.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def text_width(draw: ImageDraw.ImageDraw, value: str, face: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), value, font=face)
    return box[2] - box[0]


def wrap_words(draw: ImageDraw.ImageDraw, value: str, face: ImageFont.FreeTypeFont) -> str:
    lines: list[str] = []
    current = ""
    for word in value.split():
        candidate = f"{current} {word}".strip()
        if current and text_width(draw, candidate, face) > 1540:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return "\n".join(lines)


def centered(
    draw: ImageDraw.ImageDraw,
    value: str,
    face: ImageFont.FreeTypeFont,
    y: int,
    fill: tuple[int, int, int, int],
    stroke: int = 0,
) -> None:
    box = draw.multiline_textbbox((0, 0), value, font=face, spacing=8, align="center")
    width = box[2] - box[0]
    draw.multiline_text(
        ((WIDTH - width) / 2 - box[0], y - box[1]),
        value,
        font=face,
        fill=fill,
        spacing=8,
        align="center",
        stroke_width=stroke,
        stroke_fill=(26, 25, 22, 255),
    )


def segment_for_event(event_time: float) -> dict[str, object]:
    segments = CAPTIONS["segments"]
    selected = segments[0]
    for segment in segments:
        if float(segment["start"]) <= event_time:
            selected = segment
    return selected


def frame_at(time_seconds: float) -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    english = font(LATIN_BOLD, 46)
    chinese = font(CJK, 28)
    badge = font(LATIN_BOLD, 16)
    listening = font(LATIN, 25)

    event = None
    for candidate in LIVE["events"]:
        if float(candidate["time"]) <= time_seconds:
            event = candidate
        else:
            break

    if event is None:
        centered(draw, "listening…", listening, 145, QUIET)
        return image

    kind = str(event["kind"]).upper()
    color = ACCENT if kind == "FINAL" else QUIET
    badge_width = text_width(draw, kind, badge)
    draw.rounded_rectangle((WIDTH - 42 - badge_width - 24, 76, WIDTH - 42, 104), 14, fill=(32, 33, 30, 220))
    draw.text((WIDTH - 54 - badge_width, 81), kind, font=badge, fill=color)

    translated = wrap_words(draw, str(event["text"]), english)
    source = str(segment_for_event(float(event["time"]))["sourceText"])
    centered(draw, translated, english, 112, WHITE, stroke=2)
    centered(draw, source, chinese, 245, MUTED, stroke=1)
    return image


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    duration = float(LIVE["duration"])
    frames = math.ceil(duration * FPS)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        f"{WIDTH}x{HEIGHT}",
        "-framerate",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "qtrle",
        "-pix_fmt",
        "argb",
        str(OUTPUT),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    for frame_number in range(frames):
        process.stdin.write(frame_at(frame_number / FPS).tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise SystemExit("caption track render failed")


if __name__ == "__main__":
    main()
