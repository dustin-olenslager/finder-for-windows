# In Progress

**Read this first.** The ordered queue of what is next. Top of the list is what to pick up now.
Every item points at a plan doc — if an item has no plan doc, it is not ready to start.

The **Next step** cell of the active row is its handoff: keep the *exact next step* there — the file to
open, the command to run, the blocker — refreshed whenever you pause, so the next session resumes
cold. A row with no next step is a row nobody can pick up. (Doctrine: `.agents/rules/documentation.md`.)

Each row rolls up to a `roadmap.md` initiative (the strategic view) and leaves a trail in
`docs/agents/worklog.md`. A row with no initiative is tactical work with no strategic home — add the
initiative to `roadmap.md`, or say in Next step why it is a deliberate one-off.

When an item ships: remove its row from here, move its folder into `<area>/completed/`, and add an
entry to `completed-features.md`.

## Active queue

| # | Item | Area | Initiative | Plan doc | Status | Next step |
|---|------|------|------------|----------|--------|-----------|
| 1 | Build the Finder experience: the shell (sidebar / content / toolbar), selection and keyboard grammar, file operations with undo, the four views, previews, tags, and search with the content index | app | Finder for Windows — the app | `app/foundation/plan.md` | **M6 shipped** | M1–M7 are on `main`; `v0.5.0` carries search with the content index. Next: **M8 — packaging polish** (signed build, file-type associations), then the tags UI (the store and its tests are already in `src/application/tags.js`). |
| 2 | UI/UX audit remediation: the 50 ranked findings from four SME audits | app | Finder for Windows — the app | `audits/PLAN.md` | **In progress — P0, P1, P2 done** | P0 (correctness and honesty), P1 (keyboard and screen reader) and P2 (visual correctness) are on `main` in `v0.16.0`, `v0.17.0` and `v0.18.0`. Next: **P3 — the native tells** (real file-type icons and thumbnails, undo, drag-out, collision resolution, window bounds, the hidden-file toggle, long-path support), then P4 (composition and motion). The raw SME reports are beside the plan. |
| 3 | Electron 44 upgrade (for file-clipboard interop with Explorer, electron#51707) | app | Finder for Windows — the app | — | **Done — verifying** | `electron` ^44.7.0 and `electron-builder` ^26.15.3 are on `main` and unit-green locally. The Windows CI build is the real proof, since Electron cannot run on the Linux dev box. If the runner fails, the failure will name the config key; revert the two versions in `package.json` to go back. |

**Status vocabulary:** `Not started` · `In progress — milestone N of M` · `Blocked — <on what>` ·
`In review` · `Done — archiving`.

## Blocked / waiting

Items that cannot move, and the one thing each is waiting on. Review this list before starting
anything new — an unblocked item here outranks a fresh one.

| Item | Blocked on | Since |
|------|-----------|-------|
| Branch protection on `main` | `sh scripts/init-repo-protection.sh` has not been run (it prompts interactively). Until it is, CI is ADVISORY, not binding. | 2026-10-06 |

## Parked

Ideas deliberately deferred. Keep the reason — "we said no because X" is what stops the same
proposal coming back every month.

| Item | Why parked | Revisit when |
|------|-----------|--------------|
| HTTP API + MCP server for the file manager | No non-human consumer exists; `agent-readiness` was dropped at adapt time for exactly that reason | a real agent or automation needs to drive it |
| dependency-cruiser boundary gate | No `src/` tree to lint yet; a layout-coupled config written before the code would be rewritten | the first real module lands (see roadmap → Next) |
