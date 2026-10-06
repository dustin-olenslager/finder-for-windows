# Roadmap — the overall plan

> **SINGLE SOURCE OF TRUTH for this project's plans.** Every agent and contributor reads and edits
> *this* file. A new plan is a **row here** — never a new doc at the repo root, never a flat file in
> `docs/agents/`, never a top-level `<name>-plan/` directory. Detail belongs in
> `docs/agents/<area>/<feature>/plan.md`, linked from its row. Enforced by
> `scripts/check-plan-home.sh`.

The one canonical strategic view: the **initiatives** this project is committed to, in priority order.
One row is one initiative — a body of work that spawns several plan docs and several `in-progress.md`
queue rows — **not** a single task.

Three views, three altitudes, no overlap:

- **`roadmap.md` (this file)** — strategic. Initiatives and their band (Now / Next / Later).
- **`in-progress.md`** — tactical. The queue of what is next, which rolls up into these initiatives.
- **`worklog.md`** — the change history underneath both.

**Update it in the SAME change that starts, reprioritises, or finishes an initiative:** new initiative
→ add a row; first plan doc or queue row → link it here; last queue row ships → move the row to
**Shipped** with the date, in the same commit as the ship.

## Now — in active development

| Initiative | Intent (one line) | Queue rows (`in-progress.md`) | Plan docs |
|---|---|---|---|
| Finder for Windows — the app | Ship a Windows file manager that works like macOS Finder: Finder-familiar interactions, fast on huge folders, a beautiful tappable UI, on Windows on ARM64 (Snapdragon X) and x64 | row 1 | `app/` (first plan at `app/foundation/plan.md`) |

## Next — committed, not yet started

| Initiative | Intent | Depends on |
|---|---|---|
| Architecture-boundary gate | Add a dependency-cruiser config encoding the filled layer map, start it report-only, then make it blocking and wire it as a required CI check | the app's `src/` tree existing (row 1) |
| IPC coverage check | The ~30-line script that walks the preload channel manifest and fails on any channel file without a matching test (see `testing.md` → Coverage discipline) | the preload bridge existing (row 1) |

## Later — directional, not yet committed

Records the "why we said no / not yet" so the same idea does not get re-proposed every month (the
strategic twin of `in-progress.md` → Parked).

| Initiative | Why it matters | Revisit when |
|---|---|---|
| Agent-drivable surface (HTTP API + MCP) | Would let a harness drive the file manager headlessly | only if a real non-human consumer appears — see the rejection in `app/` plan's Deletion candidates |
| macOS build target | The design reference is macOS, so a mac build is tempting | never as a side effect of the Windows work; only if the owner asks |

## Shipped

Newest first. Each links to the `completed-features.md` entries that make it up — the strategic index
into the feature log.

| Initiative | Shipped | Features (`completed-features.md`) |
|---|---|---|
| Panoply governance kit adopted | 2026-10-06 | Panoply kit adaptation + docs/agents plan spine |
