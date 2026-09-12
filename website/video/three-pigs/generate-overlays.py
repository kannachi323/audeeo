#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1920
HEIGHT = 1080
WHITE = (255, 255, 255, 255)
MUTED = (217, 216, 209, 255)
ACCENT = (120, 215, 164, 255)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "work" / "overlays"
LATIN = "/System/Library/Fonts/Supplemental/Arial.ttf"
LATIN_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def text_width(draw: ImageDraw.ImageDraw, value: str, face: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), value, font=face)
    return box[2] - box[0]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    title = font(LATIN_BOLD, 36)
    status = font(LATIN_BOLD, 22)
    category = font(LATIN, 20)
    meta = font(LATIN, 18)

    draw.text((42, 22), "audeeo", font=title, fill=WHITE)
    label = "PREPARED DEMO"
    label_width = text_width(draw, label, status)
    label_x = WIDTH - 42 - label_width
    draw.ellipse((label_x - 31, 34, label_x - 17, 48), fill=ACCENT)
    draw.text((label_x, 27), label, font=status, fill=MUTED)
    draw.text((42, 684), "MANDARIN  →  ENGLISH", font=category, fill=(174, 173, 165, 255))
    draw.text(
        (42, 1034),
        "Prepared narration and subtitles  ·  illustrative demonstration",
        font=meta,
        fill=(143, 142, 136, 255),
    )
    image.save(OUT / "base.png")


if __name__ == "__main__":
    main()
