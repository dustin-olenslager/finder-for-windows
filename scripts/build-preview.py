#!/usr/bin/env python3
"""Build a renderable preview of the real renderer, so the layout can be SEEN.

The renderer is a static page plus window.finder (the preload bridge). This script
inlines the real index.html, style.css and app.js verbatim and prepends a stub bridge
with realistic data, so what gets rendered is the actual UI code, not a mockup.

Usage:
    python3 scripts/build-preview.py <out.html>
"""

import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
RENDERER = REPO / "src" / "renderer"


def sample_tree():
    """A believable C:\\Users\\dustin, so the preview shows real shapes and sizes."""
    return {
        "C:\\Users\\dustin": [
            ("Desktop", True, None, "2026-10-04T09:12:00"),
            ("Documents", True, None, "2026-10-05T18:40:00"),
            ("Downloads", True, None, "2026-10-06T07:55:00"),
            ("Pictures", True, None, "2026-09-28T14:02:00"),
            ("Projects", True, None, "2026-10-06T06:30:00"),
            ("Videos", True, None, "2026-09-19T11:20:00"),
            ("budget-2026.xlsx", False, 48_213, "2026-10-01T16:11:00"),
            ("notes.md", False, 3_912, "2026-10-06T08:04:00"),
            ("readme.txt", False, 611, "2026-09-30T20:45:00"),
            ("shot-list.pdf", False, 2_884_019, "2026-10-03T13:37:00"),
        ],
        "C:\\Users\\dustin\\Projects": [
            ("finder-for-windows", True, None, "2026-10-06T06:30:00"),
            ("shoot-archive", True, None, "2026-10-05T22:15:00"),
            ("archive", True, None, "2026-08-14T10:00:00"),
            ("cleanup.ps1", False, 1_204, "2026-09-22T19:03:00"),
        ],
        "C:\\Users\\dustin\\Projects\\finder-for-windows": [
            ("assets", True, None, "2026-10-05T23:59:00"),
            ("docs", True, None, "2026-10-06T06:12:00"),
            ("scripts", True, None, "2026-10-05T22:40:00"),
            ("src", True, None, "2026-10-06T07:02:00"),
            ("test", True, None, "2026-10-06T06:55:00"),
            (".gitignore", False, 402, "2026-10-05T21:30:00"),
            ("LICENSE", False, 1_077, "2026-10-05T21:31:00"),
            ("README.md", False, 4_118, "2026-10-06T06:12:00"),
            ("package.json", False, 1_240, "2026-10-06T05:48:00"),
        ],
    }


def to_items(rows):
    return [
        {
            "name": name,
            "isDirectory": is_dir,
            "size": size,
            "modifiedAt": modified,
            "isCloudPlaceholder": False,
            "metadataUnavailable": False,
        }
        for name, is_dir, size, modified in rows
    ]


STUB = """
// ---- preview stub: stands in for the preload bridge, nothing else is faked ----
const TREE = __TREE__;
const SIDEBAR = __SIDEBAR__;
const SEP = (p) => (p.includes('\\\\') ? '\\\\' : '/');
window.finder = {
  async listDirectory(path) {
    const items = TREE[path];
    if (!items) return { ok: true, path, items: [] };
    return { ok: true, path, items };
  },
  async getSidebar() { return SIDEBAR; },
  async startFolder() { return 'C:\\\\Users\\\\dustin'; },
  async joinPath(dir, name) {
    const base = dir.replace(/[\\\\/]+$/, '');
    return base + SEP(base) + name;
  },
  async parentPath(p) {
    const t = p.replace(/[\\\\/]+$/, '');
    const i = t.lastIndexOf(SEP(t));
    return i > 2 ? t.slice(0, i) : null;
  },
  async pathSegments(p) { return p.split(/[\\\\/]+/).filter(Boolean); },
  async revealInExplorer() { return { ok: true }; },
  async openWithDefault() { return { ok: true }; }
};
// ---- end stub ----
"""


def main():
    out_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "preview.html")

    tree = {path: to_items(rows) for path, rows in sample_tree().items()}

    sidebar = {
        "ok": True,
        "sections": [
            {
                "id": "favorites",
                "title": "Favorites",
                "items": [
                    {"id": "home", "label": "Home", "path": "C:\\Users\\dustin", "icon": "home"},
                    {"id": "desktop", "label": "Desktop", "path": "C:\\Users\\dustin\\Desktop", "icon": "folder"},
                    {"id": "documents", "label": "Documents", "path": "C:\\Users\\dustin\\Documents", "icon": "folder"},
                    {"id": "downloads", "label": "Downloads", "path": "C:\\Users\\dustin\\Downloads", "icon": "folder"},
                    {"id": "pictures", "label": "Pictures", "path": "C:\\Users\\dustin\\Pictures", "icon": "folder"},
                ],
            },
            {"id": "tags", "title": "Tags", "items": []},
            {
                "id": "locations",
                "title": "Locations",
                "items": [
                    {"id": "C:\\", "label": "Windows (C:)", "path": "C:\\", "icon": "drive"},
                    {"id": "D:\\", "label": "Data (D:)", "path": "D:\\", "icon": "drive"},
                    {"id": "E:\\", "label": "SanDisk (E:)", "path": "E:\\", "icon": "removable"},
                ],
            },
        ],
    }

    html = (RENDERER / "index.html").read_text()
    css = (RENDERER / "style.css").read_text()
    js = (RENDERER / "app.js").read_text()

    stub = STUB.replace("__TREE__", json.dumps(tree)).replace("__SIDEBAR__", json.dumps(sidebar))

    # The app's CSP forbids inline style/script — correct for the app, fatal for this
    # harness, which inlines the real assets into one file. Drop the meta tag here.
    html = re.sub(
        r'<meta http-equiv="Content-Security-Policy"[^>]*>', "", html
    )

    # Inline the real assets so a single file renders, and put the stub ahead of app.js
    # so the bridge exists before the renderer runs.
    html = html.replace(
        '<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>"
    )
    html = html.replace(
        '<script src="app.js"></script>', f"<script>\n{stub}\n{js}\n</script>"
    )

    # The preview is a page, not the app: it has no titleBarOverlay, so drop the strip.
    html = html.replace('<div class="titlebar"></div>', '<div class="titlebar" style="height:0"></div>')

    out_path.write_text(html)
    print(f"wrote {out_path} ({len(html)} chars)")


if __name__ == "__main__":
    main()
