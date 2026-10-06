# Plan: Foundation and the v1 Finder experience

- **Area:** `app` · **Started:** 2026-10-05 · **Status:** In progress
- **Owner:** Dustin Olenslager
- **Next step:** Build **M1** — create `package.json`, `electron-builder.yml`, the `src/` four-layer skeleton and the IPC bridge; the first acceptance run is `npm start` opening a folder and listing it through `ListDirectory`. Do NOT write renderer UI beyond the minimum M1 needs (a folder list) — the wireframe rung comes before the full interface.
- **Roadmap initiative:** `../../roadmap.md` → "Finder for Windows — the app"
- **Spec:** `spec.md` in this folder — 8 user stories, 38 `FR-001…FR-038`, no unresolved markers.
- **Domain & experts:** Desktop file management for macOS-Finder power users on Windows. The spec records the two SME-panel consultations (macOS Finder behavior; Windows platform feasibility, 2026-10-05) and states that no outside-the-software practitioner was consulted because the owner is himself the domain practitioner — his ten decisions are the domain input (`../decisions/0001-open-decisions.md`). No fabricated interview is recorded.
- **Parent plan:** _(none — this is the root plan for the initiative)_

## Goal

A person who knows Finder can install this on a Windows on ARM machine, open it, move through their
folders, see any file without opening it, find a file by a word inside it, tag it with a color, and
move or delete it safely with undo — and the window never freezes, even on a folder with a hundred
thousand entries.

We know it worked when the spec's `SC-001…SC-007` hold: the four core journeys need no instruction
(`SC-001`), a 100k-entry folder paints in under a second (`SC-002`), a warm search over a million
files returns in under 200 ms (`SC-003`), the first index pass finishes within about an hour
(`SC-004`), no destructive operation is unrecoverable (`SC-005`), it installs from one downloaded
file (`SC-006`), and no Windows Explorer setting changes (`SC-007`).

**Out of scope:** becoming the default file manager; any change to Windows Explorer's settings or
file associations (`FR-035`); a macOS build; multi-user, accounts or sharing; cloud sync; system-wide
tags, Quick Look or automation surfaces. Each of these is recorded in the spec's out-of-scope list or
the Deletion candidates table below.

## Context

A fresh session needs these facts:

- **The decisions are settled.** Ten of them, in `../decisions/0001-open-decisions.md` — including two
  owner overrides of the SME panel: **content search ships in v1** (D-0003) and the **Windows
  shortcut grammar** (`F2`, `Delete`, `Ctrl+Shift+N`) rather than a ⌘-mirror (D-0005). Do not
  re-litigate either.
- **The repo is public and MIT is not yet in place** — a `LICENSE` file is still owed.
- **Stack is fixed by `AGENTS.md`:** Node 22 LTS, Electron 43, CommonJS main process, npm,
  `electron-builder`. The prior art on this exact machine is
  `dustin-olenslager/google-messages-windows-arm` — its `electron-builder.yml`, `scripts/generate-ico.js`
  and NSIS configuration are proven for Windows on ARM64 and should be reused rather than reinvented.
- **`src/` does not exist yet.** The four layers are `target:` rows in `AGENTS.md`; M1 creates them.
- **There is no architecture-boundary linter.** `MODULE:arch` was dropped at adapt time. Adding
  dependency-cruiser is a queued `Next` initiative, deliberately deferred until a real `src/` tree
  exists (a layout-coupled config written first would be rewritten).
- **Known trap (from the Windows SME report):** reading a cloud-placeholder file hydrates it. Any
  enumeration, sort, thumbnail or index pass must check the recall attributes first (`FR-027`).
- **Known trap:** `fs.readdir` returns NTFS B-tree order, not sorted. Sort explicitly, always.

## Architecture

- **Layers touched:** all four. Domain (file-item value types, tag rules, view-state rules, search-query
  parsing), Application (the use cases: list a directory, navigate, apply a tag, move/delete/rename
  with journaling, run a search), Interface Adapters (IPC handlers and their DTO mappers, the tag
  repository, the index repository, the filesystem gateway), Frameworks & Drivers (Electron main,
  Node `fs`, SQLite, the native enumeration module, the composition root).
- **New ports (interfaces), each declared in the use-case layer and implemented at the edge:**
  - `DirectoryReader` — enumerate a directory's entries with metadata. Implemented by a Node adapter
    in M1, and by the native `FindFirstFileExW`/`FileIdBothDirectoryInfo` adapter in M6 when the
    performance budget demands it.
  - `DirectoryWatcher` — observe changes in one directory.
  - `FileOperations` — copy, move, delete-to-recycle-bin, rename, with progress and cancellation.
  - `TagRepository` — read/write tags keyed by volume + file identity.
  - `ViewStateStore` — per-folder view state (sidecar first, central fallback).
  - `OperationJournal` — record and reverse file operations.
  - `SearchIndex` — write index entries; query them.
  - `ContentExtractor` — pull searchable text out of a file by kind.
  - `ThumbnailProvider` — render a thumbnail for an item.
  - `PreviewRenderer` — resolve which in-app renderer (if any) serves a file kind.
- **Boundary data:** plain DTOs cross the IPC boundary — `FileItemDTO` (name, path, kind, size,
  timestamps, attributes, flags for hidden/system/cloud-placeholder), `TagDTO`, `ViewStateDTO`,
  `SearchQueryDTO`, `SearchResultDTO`, `OperationDTO`. Domain types never cross; the mappers live in
  the adapter layer.
- **Dependency direction:** inward only. The renderer never touches `fs`; it speaks IPC. Domain and
  application import no Electron, no Node `fs`, no SQLite, no native module.
- **Swap test:** the vendors this touches are **Electron** and **SQLite**. Replacing Electron must
  produce a diff confined to `src/infrastructure` plus the IPC adapter; replacing SQLite must produce
  a diff confined to the tag and index repositories. If a domain or use-case file appears in either
  diff, the design is wrong.

## The Algorithm pass (question · delete · simplify · accelerate · automate)

- **Question** — asked for by Dustin Olenslager, the owner and the app's only user. Every requirement
  traces to his ten recorded decisions or to the two SME reports; none is inferred.
- **Delete** — see the table below. The largest deletions are the whole shell-integration surface
  (impossible, not merely hard) and Windows Search as the index (it cannot meet the budget, so it is
  replaced, not wrapped).
- **Simplify** — one process, one window, one IPC bridge; no server, no accounts, no sync. The index
  is the only genuinely large component, and it is confined behind one port so the rest of the app is
  unaffected by how it is implemented.
- **Accelerate** — the measured bottleneck is directory enumeration with metadata: `fs.readdir` plus
  one `stat` per entry is the slow path on a 100k folder. M1 ships the simple adapter behind the
  `DirectoryReader` port and measures it; M6 replaces the adapter, not its callers. Baseline and
  target are recorded in `SC-002`.
- **Automate** — last, and only what survived. CI already runs the kit gates; a packaging step for the
  ARM64 installer is added in M8, after the app exists to package.

### Deletion candidates

| Candidate | Removed? | Why | What we do instead |
|---|---|---|---|
| Becoming the default file manager / replacing Explorer | **rejected** | No supported Windows API; the best case is registry-verb interception that breaks on updates. The SME report is explicit. | A separate app the owner opens (`FR-035` forbids touching Explorer). |
| Reading and writing real `.DS_Store` files | **rejected** | Would not interoperate with macOS anyway, and NTFS has no such convention. | A hidden sidecar file beside each folder, own format (`FR-006`). |
| NTFS alternate data streams for tags | **rejected** | Destroyed by an ordinary `fs.writeFile`, lost on exFAT/network copies, and flagged by antivirus. | App-local SQLite keyed by volume + file identity (`FR-016`, D-0004). |
| Windows Search (WSearch) as the index engine | **rejected** | Slower than the budget, spottily enabled, and inconsistently covers non-system volumes — it cannot meet `SC-003`. | An owned index behind the `SearchIndex` port (`FR-028…FR-031`). |
| Wrapping the OS preview handler for Office fidelity | **rejected** | The SME flagged hosting `IPreviewHandler` inside Electron as an unsupported, untested path. | In-app renderers with a clean "open with the default app" fallback (`FR-008`). |
| A separate content-indexing worker process | **rejected** | Complexity without a measured need; the budget is met with worker threads. | Node worker threads behind the same port; revisit only if `SC-004` fails. |
| A Finder 1:1 ⌘-as-Ctrl shortcut map | **rejected by the owner** | He chose Windows conventions. | One documented map: `F2`, `Delete`, `Ctrl+Shift+N` (`FR-024`, D-0005). |
| An HTTP API + MCP server | **rejected** | No non-human consumer exists. | Parked in `in-progress.md` → Parked; revisit if one appears. |
| Full-screen markup/rotate editing inside Quick Look | **deferred** | Real Finder has it, but it is an editing feature and this release is about seeing files. | Preview only; editing is a later candidate. |
| Duplicate detection / byte-compare | **deferred** | Not asked for by any decision or persona. | Nothing — it would need its own spec. |
| Browser-style tabs | **deferred** | Not in any decision; the spec's stories do not need it. | Single window, one location, history navigation. |
| Gallery view as a v1 requirement | **kept, reduced** | The owner chose Column as the default, but Gallery is one of Finder's four views and cheap once the thumbnail pipeline exists. | Ship it at basic fidelity in M5; no 3D cover-flow treatment. |

## Spec coverage

| Requirement | Milestone |
|---|---|
| FR-001 | M1 (shell), M3 (path bar + status area) |
| FR-002 | M2 |
| FR-003 | M4 |
| FR-004 | M4 |
| FR-005 | M4 |
| FR-006 | M5 |
| FR-007 | M3 |
| FR-008 | M5 |
| FR-009 | M5 |
| FR-010 | M7 |
| FR-011 | M7 |
| FR-012 | M7 |
| FR-013 | M7 |
| FR-014 | M5 |
| FR-015 | M5 |
| FR-016 | M5 |
| FR-017 | M5 |
| FR-018 | M4 |
| FR-019 | M4 |
| FR-020 | M4 |
| FR-021 | M4 |
| FR-022 | M4 |
| FR-023 | M4 |
| FR-024 | M3 |
| FR-025 | M6 |
| FR-026 | M6 |
| FR-027 | M6 |
| FR-028 | M7 |
| FR-029 | M7 |
| FR-030 | M7 |
| FR-031 | M7 |
| FR-032 | M6 |
| FR-033 | M6 |
| FR-034 | M8 |
| FR-035 | M8 (verified, not built — an assertion that the app does nothing) |
| FR-036 | M8 |
| FR-037 | M3 |
| FR-038 | M5 |

Every requirement is served. No `FR` is deferred.

## Milestones

- [ ] **M1 — Skeleton and the IPC bridge.** `package.json` (Node 22, Electron 43, CommonJS), `electron-builder.yml` adapted from the Messages app for ARM64 NSIS, `LICENSE` (MIT), `.gitignore`, `scripts/generate-ico.js`, and the four `src/` layers with one end-to-end slice: main process opens a folder via the `DirectoryReader` port, a `ListDirectory` use case returns `FileItemDTO[]`, the preload exposes it over `contextBridge`, and the renderer prints the list. Files: `src/domain/file-item.js`, `src/application/list-directory.js`, `src/application/ports/directory-reader.js`, `src/adapters/fs-directory-reader.js`, `src/adapters/ipc/list-directory-handler.js`, `src/infrastructure/main.js`, `src/infrastructure/composition-root.js`, `src/preload/preload.js`, minimal `src/renderer/index.html`.
- [ ] **M2 — The shell: sidebar, content pane, toolbar.** The three-region layout, Favorites, the Tags section (empty state), Locations with drives and mounted shares, the toolbar's view switcher and back/forward, and sidebar drag-to-move (`FR-002`, `FR-003` arrives here in its simplest form).
- [ ] **M3 — Selection, keyboard grammar, path bar, status area.** Marquee and Ctrl/Shift selection, the D-0005 shortcut map as one table, the breadcrumb path bar, item count and free space, and "open in Windows Explorer" (`FR-007`, `FR-024`, `FR-037`).
- [ ] **M4 — File operations with undo.** Copy, move, duplicate, rename (single and batch), new folder, delete to the Recycle Bin, Put Back, the operation journal with undo across restart, progress and cancellation, and collision prompts (`FR-018` … `FR-023`).
- [ ] **M5 — The four views, previews, and tags.** Column (default), Icon, List and Gallery; the spacebar preview overlay with arrow-key walking; thumbnails; the tag store, tag dots, the sidebar Tags browsing, the info panel, and the app-local tags statement (`FR-004`, `FR-005`, `FR-006`, `FR-008`, `FR-009`, `FR-014` … `FR-017`, `FR-023`, `FR-038`).
- [ ] **M6 — Performance and robustness.** Replace the directory adapter with the native bulk-enumeration path (`FindFirstFileExW` + `FileIdBothDirectoryInfo`); directory watching with re-list on overflow; the 100k-entry budget; cloud-placeholder protection; permission-denied and unavailable-location states; unsupported-name and long-path states (`FR-025` … `FR-027`, `FR-032`, `FR-033`).
- [ ] **M7 — Search and the index.** The search field and live results in the normal view; scope switching; the index worker, storage and incremental updates; content extraction for text/code, PDF, Office and images; saved searches in the sidebar; index state reporting, pause/resume and exclusions (`FR-010` … `FR-013`, `FR-028` … `FR-031`).
- [ ] **M8 — Packaging, verification and ship.** The unsigned ARM64 and x64 installers; update-safe data locations; the `SC-006`/`SC-007` verification runs; the full `SC-001…SC-007` measurement pass; docs, and the folder move to `completed/`.

Milestone order is deliberate: M1 is the only thing that must come first; M5 depends on M2/M3; M7 is
last among the features because the index is the largest component and it is the one whose budget
(`SC-003`, `SC-004`) can force a redesign of its own internals without touching anything else.

## Open questions

- [ ] **Wireframe rung.** The kit requires a screen before the backend for a user-facing change. M1
      deliberately builds only a minimal list view; the real interface (M2 onward) should get its
      `wireframe/index.html` + `interviews.md` first. _Blocks M2, not M1._ — recommend running the
      wireframe rung between M1 and M2.
- [ ] **`LICENSE` content.** MIT is agreed; the copyright holder line needs the owner's preferred
      form (name vs. name + year). _Blocks M8, not M1._

## Build notes

> **Build note:** 2026-10-06 — **A public-repo leak, and the gate that prevents a repeat.** Production
> naming from private work was typed into a test fixture in this public repository (`scripts/build-preview.py`,
> added with the media-stepping work). It reached two commits, was force-pushed away, and was then found
> **still fetchable by SHA** — a force-push rewrites visible history but GitHub keeps orphaned commits, and
> `refs/pull/*/head` are kept permanently for every PR. The repository was therefore deleted and recreated
> from a scrubbed history; `scripts/check-sanitize.sh` now fails the build when a private project, company,
> host, internal IP or non-noreply address appears in any tracked file, and `npm run check:sanitize` wires it
> up. The leak was never in an installer: `electron-builder` bundles only `src/**` and `package.json`.
> **Lesson:** a test fixture is published content. Scrub at authoring time, and verify a history rewrite by
> fetching the OLD SHA from the remote — not by inspecting the local tree.

> **Build note:** 2026-10-05 — The plan was written after the spec, deliberately, and every `FR` was
> mapped before any milestone was named. Two requirements changed the milestone shape: `FR-003`
> (sidebar drag-to-move) was pulled out of the operations milestone into the shell milestone because a
> sidebar that cannot receive a drop is not a Finder sidebar, and `FR-035` (change no Explorer
> setting) is a *verification* milestone item rather than a build item — it asserts an absence.

## On ship

Move this folder to `app/completed/`, rename this file to describe what shipped, add a
`completed-features.md` entry, append the final worklog line, remove row 1 from `in-progress.md`,
move the roadmap initiative to **Shipped**, and promote the durable lessons (the enumeration
performance findings and the placeholder-hydration trap) into `key-patterns.md` — all in the same
commit as the ship.
