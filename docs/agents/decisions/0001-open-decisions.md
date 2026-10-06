# Decision log — finder-for-windows

Durable record of owner decisions. **All decisions DECIDED 2026-10-05.** These are the inputs the
spec is written from; a spec requirement that contradicts this file is a defect.

## D-0001 — What kind of Finder clone? — **DECIDED**

**Behavioral clone.** Same views, shortcuts, tags, sidebar and Quick Look behavior. About 90% of
Finder is reachable on Windows.

Rejected: metadata clone (no cross-application metadata store exists on Windows); skin clone (looks
identical, does not behave identically).

## D-0002 — Default view for a new folder — **DECIDED**

**Column (Miller) view.** Cascading columns; each click drills right, the rightmost column previews
the selected item. Every folder still remembers its own last-used view; this is only the first-ever
default.

## D-0003 — v1 scope — **DECIDED**

**Fast core PLUS full content search in v1.** All four views, Quick Look, tags, sidebar, the full
keyboard grammar, per-folder view memory — **and** a self-built indexer that searches *inside* files,
not just names.

> **Owner overrode the panel's recommendation here.** The panel recommended deferring content
> indexing (it is a large, ongoing cost: index storage, incremental updates, worker scheduling and a
> performance budget). Choosing it in v1 makes the indexer a core component of the first release.
> The spec must therefore carry an explicit index scope and performance budget (D-0010) rather than
> an open-ended "index everything".

## D-0004 — Where tags live — **DECIDED**

**App-local tag database.** A sidecar SQLite file keyed by volume serial + NTFS file ID, with a
path+size+mtime fallback. Works on every filesystem including USB and network shares. Tags are
visible only inside this app — a stated product fact, not a defect.

Rejected: NTFS alternate data streams (lost on FAT/exFAT/network, antivirus-flagged, and destroyed by
an ordinary `fs.writeFile`).

## D-0005 — Keyboard shortcuts — **DECIDED**

**Windows conventions, not a Finder 1:1 map.** `F2` rename, `Delete` to trash, `Ctrl+Shift+N` new
folder.

> **Owner overrode the panel's recommendation here** (the panel suggested mirroring ⌘ as Ctrl).
> The spec must carry ONE documented shortcut map and must not silently mix the two grammars.

## D-0006 — Trash — **DECIDED**

**Wrap the Windows Recycle Bin.** Deleted items go to the normal per-volume Recycle Bin; "Put Back"
is emulated from an original path recorded in the operation journal.

## D-0007 — Per-folder view state — **DECIDED**

**A hidden sidecar file next to each folder** (Finder-style): view mode, sort, icon size and icon
positions travel with the folder. Folders that cannot be written (read-only media, some network
shares) fall back to the central store.

## D-0008 — Installer signing — **DECIDED**

**Unsigned for now.** One SmartScreen "Unknown publisher" warning on first install; revisit if it
becomes a nuisance.

## D-0009 — Which structural "impossible" gets the most effort — **DECIDED**

**Instant, Spotlight-class search with a live index.** Ranked first by the owner, and it is
consistent with D-0003: the indexer is in v1 and is the single largest engineering cost in the
project.

Documented as out of scope, deliberately: system-wide tags, system-wide Quick Look, AirDrop,
iCloud Drive placeholder semantics, Finder alias objects, and the Services / Quick Actions surface.

## D-0010 — Index scope and performance budget — **OPEN**

Forced by D-0003. Still to decide, and the spec needs a number for each:

- Which folders are indexed (whole drives? chosen roots? excluding `node_modules`, `AppData`,
  system directories?).
- Which file types get content extraction (plain text and code, PDF, Office, images via OCR?).
- Cold-scan budget (a full first pass over ~1M files) and warm-query budget (target latency).
- Index storage ceiling and what happens when it is hit.
