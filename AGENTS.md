# AGENTS.md — finder-for-windows

Canonical, provider-neutral instructions for ANY coding agent or LLM working in this repo. `scripts/sync-agents.sh` generates every tool-native mirror from this file. **What this is:** a Windows file manager that works like macOS Finder.

## Start here — read in this order, before writing anything

**Read, in order:** this file → `docs/agents/roadmap.md` (the plan: initiatives, Now / Next / Later) → `docs/agents/in-progress.md` (the queue and the *exact next step* to resume cold — **carry it forward; do NOT open a parallel track for work already queued here**) → `docs/agents/worklog.md` (what landed; append a line in the same change as your work) → `.agents/rules/clean-architecture.md` (the premise every change obeys) → the `.agents/rules/` module for what you touch (`frontend.md`, `design-system.md`, `testing.md`, …) → `docs/agents/architecture.md` and `key-patterns.md` (decisions and gotchas).

Then: **propose before you edit**, **keep roadmap / queue / worklog current in the SAME change as the work**, and **verify (test + typecheck + lint) before you commit.** Run the **Algorithm pass** — question every requirement (and name its requester), **delete what you can**, simplify, accelerate, automate last — before proposing anything structural; every plan owes a **deletion candidate list**, because deleting is the one step that leaves no artifact and is therefore the one that gets skipped. **Write the spec before the plan on anything structural** — stories each with an independent test, Given/When/Then scenarios, numbered `MUST` requirements, the domain and the outside experts consulted, four simulated persona interviews. `[NEEDS CLARIFICATION: …]` lives only in a draft spec. Doctrine: `.agents/rules/spec.md`, `algorithm.md`, `workflow.md`, `documentation.md`.

## Non-negotiables

- **Clean Architecture is the premise of all code here.** Dependencies point inward only; business rules never import a framework, Electron, the filesystem, an IPC channel, or a vendor SDK; every external concern sits behind a port with its adapter at the edge; one composition root wires them.
- **Plan before code; verify before commit.** No multi-file change without a persisted plan under `docs/agents/`; no commit without a green test / typecheck / lint run in the same session.
- **Change approval is STRICT.** Describe the change (what, which files, why), name the layers it touches, and **wait for approval before editing** — for a one-line fix as much as for a feature. The trivial carve-out does not apply in this repo.
- **The plan and worklog are never stale — and this is enforced.** Every change updates `in-progress.md` (status + Next step), appends a line to `worklog.md`, and moves the `roadmap.md` initiative when it starts or ships — in the same commit as the code. **`scripts/check-docs.sh` fails any commit that changes code but not the worklog in the same commit.**

## This project

- **Pillars:** `Finder-familiar interactions` · `fast on huge folders` · `beautiful, tappable UI`. **Design reference:** **macOS Finder** — Apple/macOS-native, light + dark, dense-but-breathable, low motion intensity except spring-loaded folders.
- **Runtime:** Node 22 LTS · Electron 43 · **CommonJS** main process. **Targets:** Windows on ARM64 (Snapdragon X) and x64. **Package manager:** npm (`package-lock.json`). **Default branch:** `main` — work lands via a branch and a PR, never a direct push.
- **Commands** (`package.json` lands in a separate batch; these are the agreed invocations): `npm install` · `npm start` (dev) · `npm run build` (ARM64) · `npm run build:x64` · `npm test` · `npm run lint` · `npm run typecheck` · `npm run format`.
- **Layers — dependencies point inward only.** Each is the agreed destination and **does not exist yet** (the source tree lands in a separate batch); do not create one just to satisfy this map, but put the first real file in the right layer:

```
target: src/domain           entities, value types, invariants, pure domain calculations
target: src/application      one unit per application operation; declares its ports
target: src/adapters         port implementations, IPC handlers, DTOs, mappers
target: src/infrastructure   Electron main, filesystem access, config, composition root
```

- **Everything else:** the plan / queue / log are in `docs/agents/`; process and review in `.agents/rules/workflow.md`, `quality-bar.md`, `git-workflow.md`, `documentation.md`; the UI in `frontend.md` + `design-system.md`; screens decided first in `wireframe-first.md`; the phase model in `factory-phases.md`; personas in `.agents/personas/README.md`; decisions in `docs/agents/architecture.md` and `key-patterns.md`. Deep rules live once under `.agents/rules/` — this file is the index.

<!-- MIRROR:start — this block is copied verbatim into every tool-native file by scripts/sync-agents.sh. Edit here only; it is the "if you read nothing else" contract for tools that do not open AGENTS.md. -->
## If you read nothing else in this repo

**Before writing anything, open `AGENTS.md` at the repo root and read it fully.** The short version:

- **Read, in order:** `docs/agents/roadmap.md` (the plan) → `docs/agents/in-progress.md` (the queue +
  the exact next step) → `docs/agents/worklog.md` (what landed recently) → `AGENTS.md` (stack +
  commands) → the `.agents/rules/` module for what you touch.
- **Carry existing work forward.** The top of `in-progress.md` is the live task with its next step —
  continue it; do NOT open a parallel track for work already queued.
- **Describe the change and wait for approval before editing.** Change approval is STRICT here.
- **Keep the plan and worklog current in the SAME change as the code.** Shipped-but-unlogged = not done.
- **Clean Architecture is mandatory:** dependencies point inward only; business rules import no
  framework / Electron / filesystem / IPC / SDK; external concerns sit behind a port with an edge adapter.

### First touch — adopt the kit before you modify anything

If this repository does not carry the Panoply kit, adopting it IS the first batch of work. Detect it
with `sh scripts/panoply.sh check` (0 current · 10 not applied · 11 partial · 12 stale · 13 unadapted ·
14 mirrors drifted · 15 the doctor itself is stale), then `apply` → `sh scripts/sync-agents.sh` →
`check` until it exits 0. Do the judgement half the checklist names (fill every token, prune the module fences that do not apply, merge — never overwrite — a pre-existing `AGENTS.md`). A
half-applied kit fails its own doc gate and looks like a doc bug, so finish it or revert it.

### MUST NOT — hard guardrails

For the agent these are enforced by `.agents/policy.md`. **That permission gate binds only
the agent** — for every other tool these are advisory doctrine, and the only cross-tool enforcement is
whatever the repo has wired server-side (branch protection + required CI). Honor them as absolute:

- **NEVER** force-push, `git reset --hard` a shared branch, delete branches/tags, or rewrite published
  history.
- **NEVER** run a destructive filesystem command (`rm -rf`, `find -delete`, `dd of=/dev/*`) or a
  destructive database command.
- **NEVER** pipe the network to a shell (`curl … | bash`, `iwr … | iex`) or install from an untrusted
  source.
- **NEVER** read or print secrets (`.env`, `*.pem`, `id_rsa`, `credentials.json`), and never put a
  credential in a git remote URL or a commit.
- **NEVER** publish a package or deploy (`npm publish`, `docker push`, …) unless the task explicitly
  asks and a human has approved.
- **ALWAYS** stop and get human approval before any change that is destructive, irreversible, or
  outside the approved scope.
<!-- MIRROR:end -->

## Enforcement — the honest version

`.agents/policy.md` is a real gate but binds **only the agent**; for every other tool the guardrails above are advisory prose. The only cross-tool enforcement is server-side — branch protection on `main` plus required CI status checks (`.github/workflows/verify.yml`). **`sh scripts/init-repo-protection.sh` has NOT been run yet, so enforcement is ADVISORY:** run it (it prompts), then mark the `verify` check required on `main`. Do not assume a gate you have not wired.

## The rules — an index, and one home for the text

Every surviving `.agents/rules/` module is listed below, generated by `scripts/sync-agents.sh` from the modules themselves. The **full text is not reproduced here** — it lives once under `.agents/rules/*.md`; the single-file mirrors (`CLAUDE.md`, Copilot, Gemini, …) carry this index, the per-rule ones (`.cursor/rules/*.mdc`) carry each rule's full body. **Do not edit between the markers** — edit the modules and re-run `sh scripts/sync-agents.sh` (`--check` fails CI if this block drifts).

<!-- PANOPLY:RULES:BEGIN — generated index from .agents/rules/*.md by scripts/sync-agents.sh. Edit the modules, not here. -->

- `algorithm` — The Algorithm: Question, Delete, Simplify, Accelerate, Automate — `.agents/rules/algorithm.md`
- `spec` — Spec before Plan — `.agents/rules/spec.md`
- `clean-architecture` — Clean Architecture — `.agents/rules/clean-architecture.md`
- `workflow` — Workflow: Change Approval & Planning — `.agents/rules/workflow.md`
- `quality-bar` — Long-Term Quality Bar — `.agents/rules/quality-bar.md`
- `git-workflow` — Git Workflow: Commits, PRs, Branching — `.agents/rules/git-workflow.md`
- `documentation` — Documentation & Memory — `.agents/rules/documentation.md`
- `code-style` — Code Style & Patterns — `.agents/rules/code-style.md`
- `testing` — Testing — `.agents/rules/testing.md`
- `error-handling` — Error Handling — `.agents/rules/error-handling.md`
- `frontend` — Front-End Engineering — `.agents/rules/frontend.md`
- `design-system` — UI Design System — `.agents/rules/design-system.md`
- `factory-phases` — The factory phases — `.agents/rules/factory-phases.md`
- `wireframe-first` — Wireframe before backend — `.agents/rules/wireframe-first.md`

<!-- PANOPLY:RULES:END -->
