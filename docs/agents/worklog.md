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
