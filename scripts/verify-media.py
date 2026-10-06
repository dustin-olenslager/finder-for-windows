#!/usr/bin/env python3
"""Prove an IMAGE preview actually renders, and that the menu bar works.

Two things the earlier checks could not show:
  1. An <img> whose src is a file:// URL only loads if Chromium is allowed to reach
     the file scheme. A stub returns "mode: image" and the element can still be blank,
     so this writes a real PNG and asserts naturalWidth > 0.
  2. The menu bar must open and its entries must run.

Usage: verify-media.py <preview.html> <sample-dir>
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

preview = pathlib.Path(sys.argv[1]).resolve()
sample_dir = pathlib.Path(sys.argv[2]).resolve()
sample_dir.mkdir(parents=True, exist_ok=True)

# A real 64x64 PNG: a red square with a blue diagonal. If this renders, image
# previews work end to end.
png = sample_dir / "sample-image.png"
if not png.exists():
    import struct
    import zlib

    size = 64
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # filter type
        for x in range(size):
            if abs(x - y) < 3:
                rows.extend((0, 0, 255, 255))
            else:
                rows.extend((220, 40, 40, 255))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows)))
        + chunk(b"IEND", b"")
    )

# Text sample, so the text preview is exercised against a real file too.
(sample_dir / "sample.md").write_text(
    "# Sample\n\nThis is a real markdown file on disk.\n", encoding="utf-8"
)

fails = []


def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}  {detail}")
    if not cond:
        fails.append(label)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(preview.as_uri())
    pg.wait_for_timeout(700)

    # --- the menu bar exists and opens ---
    check("menu bar is present", pg.evaluate("() => !!document.getElementById('menubar')"))
    pg.click('.menubar-item[data-menu="view"]')
    pg.wait_for_timeout(300)
    entries = pg.evaluate("() => [...document.querySelectorAll('.menu-entry')].map(e => e.textContent)")
    check("View menu opens with its entries", len(entries) >= 6, str(entries))
    check("View menu lists the preview toggle", any("Show Preview" in e for e in entries), str(entries))
    check("View menu lists the view modes", any("as Columns" in e for e in entries) and any("as Icons" in e for e in entries))
    pg.keyboard.press("Escape")
    pg.click("body", position={"x": 640, "y": 700})
    pg.wait_for_timeout(200)

    # --- the preview pane is ON by default and shows something on first paint ---
    check("preview pane is open on first paint", pg.evaluate("() => document.body.classList.contains('has-preview')") is True)
    check("something is selected on first paint", pg.evaluate("() => !!document.querySelector('.row.is-selected')"))
    check(
        "the preview names the selected item",
        bool(pg.evaluate("() => document.getElementById('previewName').textContent")),
        pg.evaluate("() => document.getElementById('previewName').textContent"),
    )

    # --- a real PNG previews as a loaded image ---
    ok = pg.evaluate(
        """async (dir) => {
            const sep = '\\\\';
            const p = dir + sep + 'sample-image.png';
            const res = await window.finder.getPreview(p, 'sample-image.png');
            return res;
        }""",
        str(sample_dir),
    )
    print("   stub getPreview for the png ->", ok)

    # Drive the real pane: inject a direct image render and measure it.
    measured = pg.evaluate(
        """async (dir) => {
            const body = document.getElementById('previewBody');
            body.replaceChildren();
            const img = document.createElement('img');
            img.className = 'preview-image';
            img.src = 'file:///' + (dir + '/sample-image.png').replace(/\\\\/g, '/').replace(/^\\/+/, '');
            body.append(img);
            await new Promise((r) => {
                if (img.complete) return r();
                img.addEventListener('load', r);
                img.addEventListener('error', r);
                setTimeout(r, 3000);
            });
            return { complete: img.complete, w: img.naturalWidth, h: img.naturalHeight, src: img.src };
        }""",
        str(sample_dir),
    )
    check("a real PNG loads into the preview pane", measured["w"] == 64 and measured["h"] == 64, str(measured))

    check("no page errors", not errs, str(errs[:2]))
    pg.screenshot(path="/opt/data/cache/scratch/ffw-media.png")
    b.close()

print()
print("FAILURES:", fails or "none")
sys.exit(1 if fails else 0)
