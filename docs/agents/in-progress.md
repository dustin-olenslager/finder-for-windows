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
| 1 | Build the Finder experience: the shell (sidebar / content / toolbar), selection and keyboard grammar, file operations with undo, the four views, previews, tags, and search with the content index | app | Finder for Windows — the app | `app/foundation/plan.md` | **M7 shipped** | M1–M7 are on `main`; `v0.4.0` carries the discoverable preview pane, the menu bar and Quick Look, and `v0.5.0` carries search with the content index (two-pass scan, Everywhere / This Folder scope, an index bar that states its coverage). Next: **M6 — native bulk enumeration** for 100k-file folders (the current reader stats each entry in turn, which is fine at 10k and slow at 200k), then **M8 — packaging polish** (signed build, file-type associations), then the tags UI (the store and its tests are already in `src/application/tags.js`). |

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
