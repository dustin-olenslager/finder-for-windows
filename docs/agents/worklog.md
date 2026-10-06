# Worklog

The running per-change history. One line per landed change, newest first, appended **in the same
commit as the change** (`.agents/rules/documentation.md` → the same-change update contract).
`scripts/check-docs.sh` fails any commit that changes code but not this file, so the line is the one
mechanically-enforced part of that contract.

A `CHANGELOG.md` would supersede this file — the gate resolves `CHANGELOG.md` first. This repo has
none, so this is the worklog target.

Format: `- YYYY-MM-DD — <what changed, and where>`

---

- 2026-10-06 — Adopted the Panoply governance kit: adapted `AGENTS.md` (stack, commands, layer map, STRICT approval), pruned 8 inapplicable rule modules, filled every placeholder, scaffolded `docs/agents/` (roadmap, in-progress, worklog, completed-features, architecture, key-patterns).
- 2026-10-05 — Recorded all ten owner decisions (D-0001 … D-0010) in `docs/agents/decisions/0001-open-decisions.md`, including two owner overrides of the SME panel (content search in v1; Windows shortcut grammar). Added the durable decision card (`docs/index.html`, published via GitHub Pages) and its rendered PNG.
- 2026-10-05 — Wrote `docs/agents/app/foundation/spec.md`: goal, 8 user stories each with an independent test, 38 numbered requirements, edge cases, entities, 7 measurable success criteria, assumptions, the SME-panel expert record and 4 simulated persona interviews.
- 2026-10-05 — Wrote `docs/agents/app/foundation/plan.md`: Architecture (10 named ports), the Algorithm pass with an argued `Deletion candidates` table (7 rejections, 3 deferrals, 1 reduction), a `Spec coverage` table mapping all 38 requirements to milestones, and 8 milestones.
- 2026-10-05 — **M1 shipped** (`fb898ac`): the Electron skeleton, the four `src/` layers, the `DirectoryReader` port and its fs adapter, the `ListDirectory` use case, the preload bridge and a minimal list view; 7 tests green. Added `package-lock.json`, `LICENSE`, `README.md`, `electron-builder.yml`, `scripts/make-icon.py` and `.github/workflows/build-windows.yml`.
- 2026-10-05 — **First installer released**: `v0.1.0` carries `FinderForWindows-Setup-0.1.0-arm64.exe` plus the x64 and portable builds. Two CI defects found and fixed: electron-builder publishing without a token (`publish: null`) and the yml pinning `arch` so the x64 job emitted arm64 artifacts. ADR-0001 (no PRs) and ADR-0002 (installers built in CI) recorded in `architecture.md`.
- 2026-10-06 — **Fixed the drive-root bug the owner hit.** On Windows "C:" is the *current directory of drive C*, not its root, so going up from `C:\Users` produced `C:` and the app listed its own install folder with every entry's metadata unreadable. `src/domain/paths.js` now owns all path arithmetic (bare drive → root, UNC roots, roots that cannot go up); 8 tests pin it. The renderer no longer touches separators at all — it calls `join-path` / `parent-path` over IPC.
- 2026-10-06 — **M2 shipped**: the Finder shell. Sidebar (Favorites from known folders, Locations from real drives via CIM, Tags placeholder), toolbar with back/forward/up and a view switcher, and **column view** as the default — clicking a folder opens the next column beside it, exactly as Finder does. List and icon views included, live filtering in the status bar, macOS-style chrome (hidden title bar with a drag strip). `scripts/build-preview.py` renders the real renderer against a stub bridge and `scripts/verify-ui.py` drives it: 31 behavioral checks pass with no page errors.
- 2026-10-06 — **M3, M4 and M5 shipped** (`f1e1165`, released as `v0.3.0`): **previews** (a docked pane on Ctrl-I plus Quick Look on the spacebar — images, video, audio and PDFs inline, text and code read as a bounded 64 KB head so a huge log opens instantly and a cloud placeholder is never fully hydrated); **keyboard grammar** (arrows move the selection in the *focused* column, Enter opens, F2 renames, Ctrl+Shift+N creates, Delete trashes, Ctrl+F searches); **file operations** with an inline name dialog that re-asks with the reason when Windows refuses a name, deletion to the Recycle Bin, and a clickable breadcrumb path bar. Three bugs found by the tests: the adapter emitted `mtime` while the renderer read `modifiedAt` (the Date column would have been blank on Windows), selection lost the item's size, and the arrow keys moved the selection in the empty preview column. 49 unit tests, 55 behavioral checks.

