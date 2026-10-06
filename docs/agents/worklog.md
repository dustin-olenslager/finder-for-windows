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

