"""Render the NeonStage app icon (and companion icons such as NeonAmp) as .ico + .png.

Requires Pillow:  python -m pip install pillow
Example:
  python scripts/make-icon.py --text NS --from-color "#ff3fd2" --to-color "#22e6ff" \
      --ico build/icon.ico --png build/icon.png
"""

from __future__ import annotations

import argparse
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

MASTER = 1024
ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def hex_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) != 6:
        raise SystemExit(f"Not a hex colour: {value}")
    return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))


def lighten(color: tuple[int, int, int], amount: float = 0.3) -> tuple[int, int, int]:
    return tuple(round(channel + (255 - channel) * amount) for channel in color)


def gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    ramp = Image.new("RGB", (size, size))
    pixels = ramp.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(3))
    return ramp


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def stroke_mask(size: int, radius: int, width: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    inset = width // 2
    draw.rounded_rectangle(
        (inset, inset, size - 1 - inset, size - 1 - inset),
        radius=radius - inset,
        outline=255,
        width=width,
    )
    return mask


def load_font(size: int, override: str | None) -> ImageFont.FreeTypeFont:
    candidates = [override] if override else FONT_CANDIDATES
    for path in candidates:
        if path and os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit("No bold font found; pass --font <path-to-ttf>")


def text_mask(text: str, size: int, font: ImageFont.FreeTypeFont, tracking: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    widths = [draw.textlength(char, font=font) for char in text]
    total = sum(widths) + tracking * (len(text) - 1)
    ascent, descent = font.getmetrics()
    x = (size - total) / 2
    y = (size - (ascent + descent)) / 2
    for char, width in zip(text, widths):
        draw.text((x, y), char, font=font, fill=255)
        x += width + tracking
    return mask


def build(text: str, start: tuple[int, int, int], end: tuple[int, int, int], font_path: str | None) -> Image.Image:
    size = MASTER
    radius = round(size * 0.22)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile = rounded_mask(size, radius)

    body = Image.new("RGB", (size, size), (12, 10, 20))
    body_draw = ImageDraw.Draw(body)
    top, bottom = (12, 10, 20), (26, 20, 44)
    for y in range(size):
        t = y / (size - 1)
        body_draw.line((0, y, size, y), fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    icon.paste(body, (0, 0), tile)

    ramp = gradient(size, start, end)

    border = stroke_mask(size, radius, round(size * 0.022))
    glow = border.filter(ImageFilter.GaussianBlur(size * 0.03)).point(lambda v: min(255, round(v * 1.5)))
    icon.paste(ramp, (0, 0), Image.composite(glow, Image.new("L", (size, size), 0), tile))
    icon.paste(ramp, (0, 0), border)

    font = load_font(round(size * 0.44), font_path)
    letters = text_mask(text, size, font, round(size * 0.02))
    halo = letters.filter(ImageFilter.GaussianBlur(size * 0.03)).point(lambda v: min(255, round(v * 1.1)))
    icon.paste(ramp, (0, 0), halo)
    icon.paste(gradient(size, lighten(start), lighten(end)), (0, 0), letters)

    return icon


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a neon app icon.")
    parser.add_argument("--text", default="NS")
    parser.add_argument("--from-color", default="#ff3fd2")
    parser.add_argument("--to-color", default="#22e6ff")
    parser.add_argument("--font", default=None)
    parser.add_argument("--ico", default="build/icon.ico")
    parser.add_argument("--png", default="build/icon.png")
    args = parser.parse_args()

    icon = build(args.text, hex_rgb(args.from_color), hex_rgb(args.to_color), args.font)

    for target in (args.ico, args.png):
        folder = os.path.dirname(target)
        if folder:
            os.makedirs(folder, exist_ok=True)

    icon.resize((512, 512), Image.LANCZOS).save(args.png)
    icon.save(args.ico, sizes=ICO_SIZES)
    print(f"wrote {args.ico} and {args.png}")


if __name__ == "__main__":
    main()
