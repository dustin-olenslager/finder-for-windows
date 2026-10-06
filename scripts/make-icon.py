#!/usr/bin/env python3
"""Draw the Finder for Windows app icon and write every raster size it needs.

Run with the venv that has Pillow + numpy:
    /opt/data/venvs/google-workspace/bin/python scripts/make-icon.py

Outputs:
    build/icon.ico        multi-resolution Windows icon (exe + installer)
    assets/icon-<n>.png   the individual sizes, for the repo record

Design notes (why it looks the way it does):
  - Proportions follow a Finder folder: wider than tall, a prominent tab roughly
    40% of the width, and a front panel that overhangs the tab so the tab reads as
    a separate back layer rather than a bump.
  - Depth comes from three cues only: a soft drop shadow under the whole shape, a
    darker back layer, and a vertical gradient on the front panel. There is no
    gloss bar -- a straight capsule on a rounded folder reads as a stray artifact.
  - Every frame is drawn from ONE master render and downsampled, so the small
    sizes stay consistent with the large ones.
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"
BUILD.mkdir(exist_ok=True)
ASSETS.mkdir(exist_ok=True)

SIZES = [16, 24, 32, 48, 64, 128, 256]
MASTER = 1024

RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS

# macOS folder blue: a light top edge falling to a deeper base.
FRONT_TOP = (86, 172, 255, 255)
FRONT_MID = (24, 133, 245, 255)
FRONT_BOT = (0, 94, 199, 255)
BACK = (124, 190, 252, 255)


def _lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def draw_folder(size: int) -> Image.Image:
    """Render the icon at `size` px on a transparent canvas."""
    s = size
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # --- geometry: a folder is wider than tall, with a generous tab -----------
    pad_x = int(s * 0.075)
    pad_y = int(s * 0.175)
    left, right = pad_x, s - pad_x
    width = right - left
    bottom = s - pad_y

    tab_h = int(s * 0.165)
    tab_top = pad_y
    tab_right = left + int(width * 0.42)

    front_top = tab_top + int(s * 0.125)
    radius_back = max(2, int(s * 0.05))
    radius_front = max(2, int(s * 0.062))

    # --- 1. drop shadow -------------------------------------------------------
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (left + int(s * 0.014), front_top + int(s * 0.034), right - int(s * 0.014), bottom + int(s * 0.026)),
        radius=radius_front,
        fill=(0, 34, 78, 150),
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(1.0, s * 0.020))))

    # --- 2. back layer: the tab, plus the sliver of body behind the front -----
    back = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(back)
    # Tab (its own rounded shape) then the back body, both in the lighter blue.
    bd.rounded_rectangle((left, tab_top, tab_right, tab_top + tab_h * 2), radius=radius_back, fill=BACK)
    bd.rounded_rectangle((left, tab_top + tab_h, right, bottom), radius=radius_back, fill=BACK)
    # A touch of shading so the back layer is not flat.
    bd.rounded_rectangle(
        (left, bottom - int(s * 0.10), right, bottom), radius=radius_back, fill=(96, 168, 240, 255)
    )
    canvas.alpha_composite(back)

    # --- 3. front panel: vertical gradient, masked to a rounded rect ----------
    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    span = max(1, bottom - front_top)
    for y in range(front_top, bottom + 1):
        t = (y - front_top) / span
        color = _lerp(FRONT_TOP, FRONT_MID, t / 0.55) if t < 0.55 else _lerp(FRONT_MID, FRONT_BOT, (t - 0.55) / 0.45)
        gd.line([(0, y), (s, y)], fill=color)

    front_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(front_mask).rounded_rectangle(
        (left, front_top, right, bottom), radius=radius_front, fill=255
    )
    canvas.paste(grad, (0, 0), front_mask)

    # --- 4. inner sheen: a soft light band hugging the front panel's top edge --
    # Drawn as a masked gradient, so it follows the panel's curvature instead of
    # sitting on it as a separate capsule.
    sheen = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    shd = ImageDraw.Draw(sheen)
    sheen_h = int(s * 0.055)
    for y in range(front_top, front_top + sheen_h):
        t = (y - front_top) / max(1, sheen_h)
        alpha = round(58 * (1 - t) ** 1.6)
        shd.line([(0, y), (s, y)], fill=(255, 255, 255, alpha))
    sheen.putalpha(Image.composite(sheen.getchannel("A"), Image.new("L", (s, s), 0), front_mask))
    canvas.alpha_composite(sheen)

    return canvas


def main() -> None:
    master = draw_folder(MASTER)

    for size in SIZES:
        master.resize((size, size), RESAMPLE).save(ASSETS / f"icon-{size}.png")

    # Pillow writes the >=256 frame as PNG and the smaller frames as uncompressed
    # BMP inside the .ico -- which is what Explorer's paint path needs for the
    # small sizes (a PNG-compressed small frame renders as a blank glyph).
    master.resize((256, 256), RESAMPLE).save(BUILD / "icon.ico", format="ICO", sizes=[(s, s) for s in SIZES])
    master.resize((512, 512), RESAMPLE).save(BUILD / "icon.png")

    print(f"wrote {BUILD / 'icon.ico'} and {len(SIZES)} PNGs in {ASSETS}")


if __name__ == "__main__":
    main()
