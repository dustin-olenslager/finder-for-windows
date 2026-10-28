# Plan: the architecture gate — the layer map, enforced

- **Area:** `app` · **Started:** 2026-10-28 · **Status:** In progress
- **Owner:** builder
- **Next step:** merge after review. After that, the loop is: any future violation is either fixed or, only if it cannot be fixed in that change, recorded with `npm run arch:baseline` and named in the PR body.
- **Roadmap initiative:** Finder for Windows — the app (`../../roadmap.md`), as the enforcement half of the four-layer map the app is built on.
- **Spec:** `spec.md` in this folder — seven numbered requirements, four user stories each with an independent test.
- **Domain & experts:** consumer desktop file management; already recorded in `app/foundation/spec.md`. No outside expert was consulted for this change and none is claimed — it is an enforcement mechanism, not a product decision. `clean-architecture.md` names the setup.

## Goal

After this ships, an outward import in this repo fails a command instead of surviving to release. `npm run arch:check` reads the real `require()` graph across `src/` and refuses the seven inversions the layer map forbids: domain importing anything but itself, application importing adapters or the I/O built-ins, adapters importing the composition root, the renderer importing the OS layer, preload importing the inner layers, and any cycle. The same command runs in required CI, so it binds a contributor who never opens `.agents/rules/`.

We know it worked when the clean tree cruises at zero violations and each of four deliberately planted inversions fails with its own rule name.

**Out of scope:** fixing architecture debt (there is none), adding layers, changing the layer map, IPC channel coverage, and any change to `src/`.

## Context

`completed-features.md` records the gap in the kit-adaptation entry: *"the architecture-enforcement block was dropped because no dependency-boundary linter exists yet."* `.agents/rules/clean-architecture.md` carries the same admission in its "Enforcement — the gate, not just the checklist" section, along with the recommended setup: add dependency-cruiser, encode the four rows of the layer map, wire it into CI, and start report-only so the count is visible before it blocks.

This plan executes that recommendation, with one deviation argued below: the report-only phase is skipped because the count is already zero.

The stack decided the tool. This is a CommonJS Electron app with no TypeScript build, so dependency-cruiser reads `require()` and `import` alike and needs no compiler; an `ArchUnit`-style in-test linter would have to run under `node --test` and would police only what the test imports.

The tree is already clean, which is the reason a blocking gate is safe here: `src/domain` has five files and no non-relative `require` at all; `src/application` has fifteen files and exactly one external require, `node:path`; nothing in `src/adapters` imports `src/infrastructure`.

## Architecture

- **Layers touched:** none. This change adds a check and a CI step; it does not add or modify a file under `src/`. The layer map itself is the subject, not the object.
- **New ports (interfaces):** none.
- **Boundary data:** none — the gate reads the import graph.
- **Dependency direction:** the gate is a devDependency (`dependency-cruiser`) plus one config file at the repo root; nothing in `src/` gains a dependency, and the check ships in devDependencies only.
- **Swap test:** swapping the linter means replacing `.dependency-cruiser.cjs` and the two `package.json` scripts. No domain or use-case file appears in that diff — which is the point: the enforcement lives entirely outside the layers it enforces.

## The Algorithm pass (question · delete · simplify · accelerate · automate)

- **Question** — Dustin asked for the layer map to be enforced rather than asserted (the kit's `clean-architecture.md` records the requirement as the follow-through on a dropped block; `completed-features.md` records the drop). The constraint it serves: an agent or contributor who never reads the rules cannot land an outward import.
- **Delete** — see the candidates table. Four rejected additions, one script deleted before it was written.
- **Simplify** — the least shape is dependency-cruiser's own CLI plus a baseline file, not a bespoke gate script. Pushd carries a 347-line `check-architecture.mjs` for the same job because it needs coverage assertions across a monorepo; this repo has six flat layer directories, so the tool's native `--ignore-known` baseline is enough. Two npm scripts, one config, one step.
- **Accelerate** — measured: the cruise takes **0.86 s** over 38 modules / 50 dependencies on this box (three runs: 856 / 874 / 862 ms, `depcruise src …` including npx startup), which is noise beside the existing `typecheck` and `test` steps. The bottleneck it removes is a review that has to read every import block in a diff; that has no measured time but a known failure — the undefined `transferFiles` reference in the composition root reached a release candidate, which is the class of defect a graph check reads for free.
- **Automate** — this whole change *is* an automation, and the steps above were run on it first: the requirement is named, four candidate mechanisms were deleted, and the shape was reduced to the tool's native baseline. It is the last step, not the first.

### Deletion candidates

| Candidate | Removed? | Why |
|---|---|---|
| A bespoke `scripts/check-architecture.mjs` (pushd's 347-line gate) | **Deleted before writing** | Carries monorepo coverage assertions, a baseline writer, and a custom reporter. This repo has six flat layer directories and no workspace: the same outcome is `depcruise --ignore-known`. Simplification, not capability loss. |
| A report-only phase before blocking | **Deleted** | The doctrine recommends it so the violation count is visible first. Measured count is **0**, so report-only would enforce nothing for a cycle. The evidence that the blocking gate detects is four planted probes instead. |
| An ESLint `no-restricted-imports` block | **Deleted** | ESLint sees one file at a time; it cannot express "no file in `src/domain` imports any file outside `src/domain`" without enumerating every outer path in every rule file, and it cannot see cycles at all. |
| A `tsc`-based check | **Deleted** | There is no TS build here; `typecheck` runs `tsc -p jsconfig.json` over JS with `checkJs`, and TypeScript does not model layer boundaries. |
| Rule modules or a new `.agents/rules/architecture-gate.md` | **Rejected** | The rule already exists; this change makes it mechanical. A second doc would be a fork of the same rule. `clean-architecture.md` is amended instead. |
| A pre-commit hook | **Rejected** | Skippable with `--no-verify`, so it cannot be the plane that holds. CI is, per the same doctrine. |

## Milestones

**M1 — the config and the scripts.** `.dependency-cruiser.cjs`, `arch:check`, `arch:baseline`, an empty baseline, and a green run on the current tree. Done.

**M2 — proof the gate bites.** Four planted inversions, each failing with its own rule name; each restored; the tree green again afterwards. Done — results in the PR body.

**M3 — the CI step and the doctrine.** Uncomment the `Architecture boundaries` step in `verify.yml` with the real command, and replace the "Not wired yet" note in `.agents/rules/clean-architecture.md` with the wired truth. Done.

## Build notes

- **The first rule was wrong and the probe caught it.** `domain-stays-pure` was written against `dependencyTypes: ["core","npm"]`; appending `require('electron')` to `src/domain/paths.js` produced a clean pass, because a devDependency classifies as `npm-dev`. The rule is now path-based — `to: { pathNot: "^src/domain/" }` — which is also what the layer map actually says. A gate whose first version could not detect the most likely violation is the reason M2 exists.
- **`--ignore-known` requires the baseline file to exist**, and errors out when it does not. The baseline is therefore committed with the honest content for today's tree: `[]`. Regenerating it reproduces the same file byte for byte (verified by diff), so it certifies a measurement rather than recording an attempt.
- **`node:path` stays legal in `src/application`.** Path arithmetic is pure; forbidding it would push `normalizePath` into an adapter for no architectural gain. The I/O built-ins and `electron` are forbidden there.
- **`npm warn install-scripts`** on install: `electron-winstaller` asks to run a 7z arch selector and is blocked by this box's script policy. Not invoked by `arch:check`, which needs only the import graph.

## Expert review

Who should read this before it merges, and what each is asked to check. Unchecked = not yet read by a
human; this section is a work list, not a claim that review happened.

- [ ] **Owner (Dustin)** — is a blocking gate the right call here, or does he want it report-only for a
      release cycle? The kit recommends report-only; this plan skips it because the measured count is
      zero. That is the one judgement call in the change.
- [ ] **Reviewer, architecture** — are the six rules the right six for THIS layer map, and is
      allowing `node:path` in `src/application` the right call rather than an exception that quietly
      licenses more I/O later?
- [ ] **Reviewer, CI** — does the `npm install --no-save dependency-cruiser@^18.7.0` step behave the same
      way the eslint step does in this workflow (pinned, no lockfile dependency), and should it instead
      run after a full `npm ci` once the typecheck gap below is closed?
- [ ] **Reviewer, doctrine** — does `clean-architecture.md` now describe the mechanism accurately, with
      no claim stronger than what CI actually enforces (the `verify` check is not yet marked required on
      `main`, because branch protection is unwired)?

## Verification

| gate | result |
|---|---|
| `npm run arch:check` | exit 0 — `38 modules, 50 dependencies cruised`, 0 violations |
| probe: `electron` in `src/domain` | exit 1 — `domain-stays-pure` |
| probe: `node:fs` in `src/domain` | exit 1 — `domain-stays-pure` |
| probe: `node:child_process` in `src/application` | exit 1 — `application-no-io-or-framework` |
| probe: `../adapters/...` in `src/renderer` | exit 1 — `renderer-no-inner-layers` |
| `npm run lint` / `typecheck` / `test` | see the PR body — unchanged by this diff |
| `check-docs`, `check-plan-home`, `check-algorithm`, `check-spec` | see the PR body |
