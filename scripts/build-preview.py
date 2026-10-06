#!/usr/bin/env python3
"""Build a renderable preview of the real renderer, so the layout can be SEEN.

The renderer is a static page plus window.finder (the preload bridge). This script
inlines the real index.html, style.css and app.js verbatim and prepends a stub bridge
with realistic data, so what gets rendered is the actual UI code, not a mockup.

Usage:
    python3 scripts/build-preview.py <out.html>
"""

import datetime
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
            ("Desktop", True, None, "2026-10-04T09:12:00", "folder"),
            ("Documents", True, None, "2026-10-05T18:40:00", "folder"),
            ("Downloads", True, None, "2026-10-06T07:55:00", "folder"),
            ("Pictures", True, None, "2026-09-28T14:02:00", "folder"),
            ("Projects", True, None, "2026-10-06T06:30:00", "folder"),
            ("Videos", True, None, "2026-09-19T11:20:00", "folder"),
            ("budget-2026.xlsx", False, 48_213, "2026-10-01T16:11:00", "spreadsheet"),
            ("logo.png", False, 184_320, "2026-10-02T12:00:00", "image"),
            ("notes.md", False, 3_912, "2026-10-06T08:04:00", "text"),
            ("readme.txt", False, 611, "2026-09-30T20:45:00", "text"),
            ("shot-list.pdf", False, 2_884_019, "2026-10-03T13:37:00", "pdf"),
        ],
        "C:\\Users\\dustin\\Projects": [
            ("finder-for-windows", True, None, "2026-10-06T06:30:00", "folder"),
            ("shoot-archive", True, None, "2026-10-05T22:15:00", "folder"),
            ("archive", True, None, "2026-08-14T10:00:00", "folder"),
            ("cleanup.ps1", False, 1_204, "2026-09-22T19:03:00", "code"),
        ],
        "C:\\Users\\dustin\\Projects\\finder-for-windows": [
            ("assets", True, None, "2026-10-05T23:59:00", "folder"),
            ("docs", True, None, "2026-10-06T06:12:00", "folder"),
            ("scripts", True, None, "2026-10-05T22:40:00", "folder"),
            ("src", True, None, "2026-10-06T07:02:00", "folder"),
            ("test", True, None, "2026-10-06T06:55:00", "folder"),
            (".gitignore", False, 402, "2026-10-05T21:30:00", "text"),
            ("LICENSE", False, 1_077, "2026-10-05T21:31:00", "text"),
            ("README.md", False, 4_118, "2026-10-06T06:12:00", "text"),
            ("package.json", False, 1_240, "2026-10-06T05:48:00", "code"),
        ],
    }


def to_items(rows):
    return [
        {
            "name": name,
            "isDirectory": is_dir,
            "size": size,
            "modifiedAt": modified,
            # The real reader emits createdAt (NTFS birthtime). The harness must model
            # the same shape, or a UI feature that depends on it cannot be verified.
            # Fixtures give ISO strings, so derive in the same units the app formats.
            "createdAt": (
                datetime.datetime.fromisoformat(modified).timestamp() * 1000 - 86400000
                if modified
                else None
            ),
            "kind": kind,
            "isCloudPlaceholder": False,
            "metadataUnavailable": False,
        }
        for name, is_dir, size, modified, kind in rows
    ]


STUB = """
// ---- preview stub: stands in for the preload bridge, nothing else is faked ----
const TREE = __TREE__;
const SIDEBAR = __SIDEBAR__;
const PREVIEWS = __PREVIEWS__;
const SEARCH_RECORDS = __SEARCH_RECORDS__;
const INDEX_STATUS = __INDEX_STATUS__;
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
  async pathSegments(p) {
    const parts = p.replace(/[\\\\/]+$/, '').split(/[\\\\/]+/).filter(Boolean);
    return parts.length ? [parts[0] + '\\\\'].concat(parts.slice(1)) : [];
  },
  async getPreview(path, name) {
    const key = String(name || '').toLowerCase();
    for (const [ext, payload] of Object.entries(PREVIEWS)) {
      if (key.endsWith('.' + ext)) return payload;
    }
    return { ok: true, mode: 'system', kind: 'other', extension: '', note: 'No preview for this file type.' };
  },
  async fileOperation() { return { ok: true }; },
  // The real app copies through Electron's clipboard module. The harness records what
  // was copied so a test can assert the VALUE, not just that a toast appeared.
  async copyText(text) {
    const value = String(text ?? '');
    if (value === '') return { ok: false, error: 'Nothing to copy.' };
    window.__copied = value;
    return { ok: true, value: window.__copied };
  },
  async revealInExplorer() { return { ok: true }; },
  async openWithDefault() { return { ok: true }; },
  async indexStatus() { return INDEX_STATUS; },
  async buildIndex() { return { ok: true }; },
  async cancelIndex() { return { ok: true }; },
  onIndexProgress() { return () => {}; },
  async listTags() { return {}; },
  async tagItem() { return { ok: true }; },
  async untagItem() { return { ok: true }; },
  async search(request) {
    const q = (request && request.text ? request.text : '').toLowerCase().trim();
    if (!q) return { ok: true, results: [], total: 0, scanned: 0 };
    const terms = q.split(/\\s+/).filter(Boolean);
    const out = [];
    for (const record of SEARCH_RECORDS) {
      if (request.scope === 'folder' && request.folder) {
        const prefix = request.folder.toLowerCase().replace(/[\\\\/]+$/, '') + '\\\\';
        if (!record.path.toLowerCase().startsWith(prefix)) continue;
      }
      const name = record.name.toLowerCase();
      const content = (record.content || '').toLowerCase();
      const nameHit = terms.every((t) => name.includes(t));
      const contentHit = !nameHit && terms.every((t) => content.includes(t));
      if (!nameHit && !contentHit) continue;
      out.push({
        path: record.path, name: record.name, size: record.size,
        modifiedAt: record.modifiedAt, kind: record.kind,
        matched: nameHit ? 'name' : 'content'
      });
    }
    out.sort((a, b) => (a.matched === b.matched ? 0 : a.matched === 'name' ? -1 : 1));
    return { ok: true, results: out, total: out.length, scanned: SEARCH_RECORDS.length };
  }
};
// ---- end stub ----
"""


def main():
    out_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "preview.html")

    # Search fixtures: one name hit, one content-only hit, one that matches neither.
    search_records = [
        {
            "path": "C:\\Users\\dustin\\Videos\\shot-list-final.mp4",
            "name": "shot-list-final.mp4",
            "size": 1048576,
            "modifiedAt": 1759700000000,
            "kind": "video",
            "content": "",
        },
        {
            "path": "C:\\Users\\dustin\\Documents\\meeting.md",
            "name": "meeting.md",
            "size": 2048,
            "modifiedAt": 1759600000000,
            "kind": "text",
            # "shot list" appears only INSIDE this file.
            "content": "we reviewed the shot list and agreed on the schedule",
        },
        {
            "path": "C:\\Users\\dustin\\Documents\\budget-2026.xlsx",
            "name": "budget-2026.xlsx",
            "size": 40960,
            "modifiedAt": 1759500000000,
            "kind": "spreadsheet",
            "content": "quarterly figures",
        },
    ]

    index_status = {
        "ok": True,
        "running": False,
        "stats": {"files": 3, "folders": 2, "contentRead": 2, "elapsedMs": 4200, "finishedAt": 1759700000000},
    }

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

    # Preview payloads per extension, so the pane can be exercised offline.
    previews = {
        "md": {
            "ok": True,
            "mode": "text",
            "kind": "text",
            "extension": "md",
            "text": "# Finder for Windows\n\nA file manager that works like macOS Finder.\n\n## Status\n\nPre-release.\n",
            "truncated": False,
            "looksBinary": False,
        },
        "txt": {
            "ok": True,
            "mode": "text",
            "kind": "text",
            "extension": "txt",
            "text": "Notes for the week\n------------------\n\n- Review the shot list\n- Send the invoice\n",
            "truncated": False,
            "looksBinary": False,
        },
        "json": {
            "ok": True,
            "mode": "text",
            "kind": "code",
            "extension": "json",
            "text": '{\n  "name": "finder-for-windows",\n  "version": "0.3.0"\n}\n',
            "truncated": False,
            "looksBinary": False,
        },
        "pdf": {"ok": True, "mode": "system", "kind": "pdf", "extension": "pdf", "note": "Opens in another app."},
        "png": {"ok": True, "mode": "image", "kind": "image", "extension": "png"},
        "jpg": {"ok": True, "mode": "image", "kind": "image", "extension": "jpg"},
        "jpeg": {"ok": True, "mode": "image", "kind": "image", "extension": "jpeg"},
        "gif": {"ok": True, "mode": "image", "kind": "image", "extension": "gif"},
        "webp": {"ok": True, "mode": "image", "kind": "image", "extension": "webp"},
        "xlsx": {"ok": True, "mode": "system", "kind": "spreadsheet", "extension": "xlsx", "note": "No preview for this file type."},
    }

    html = (RENDERER / "index.html").read_text()
    css = (RENDERER / "style.css").read_text()
    js = (RENDERER / "app.js").read_text()

    stub = (
        STUB.replace("__TREE__", json.dumps(tree))
        .replace("__SIDEBAR__", json.dumps(sidebar))
        .replace("__PREVIEWS__", json.dumps(previews))
        .replace("__SEARCH_RECORDS__", json.dumps(search_records))
        .replace("__INDEX_STATUS__", json.dumps(index_status))
    )

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
