# Spec: the architecture gate — the layer map, enforced

- **Area:** `app` · **Started:** 2026-10-28 · **Status:** Draft → implemented with the plan beside it
- **Owner:** builder
- **Plan:** `plan.md` in this folder

## Goal

After this ships, the four-layer map that `AGENTS.md` and `.agents/rules/clean-architecture.md` already
commit to is checked by a command instead of by a reviewer's memory. A change that makes
`src/domain` import Electron, or `src/application` open a file, fails `npm run arch:check` locally and
fails `verify` in CI — no reviewer has to notice it, and no agent can skip it with `--no-verify`.

Today the rule is real prose and zero enforcement: the kit's adapt-time record in
`completed-features.md` says the architecture-enforcement block was **dropped** because no
dependency-boundary linter existed, and `clean-architecture.md` carries a "Not wired yet, and said out
loud rather than assumed" note. That note is the gap this closes.

**Out of scope:** fixing any architecture debt (there is none to fix — the tree cruises at 0
violations), adding a fifth layer, changing the layer map, and any IPC/channel coverage check.

Wireframe: n/a — this change adds a build-time check and a CI step. There is no screen, no control,
and no copy: nothing a user looks at changes, so there is no wireframe to decide first.

## User stories

### US-1 — a boundary inversion fails before review (P1)

As the repo owner, I want an outward import to fail a command I can run and CI runs, so a violation
stops at the gate instead of surviving to a release.

**Independent test:** append `require('electron')` to a file in `src/domain`, run `npm run arch:check`,
and it exits non-zero naming rule `domain-stays-pure` and the offending edge; restore the file and it
exits 0.

### US-2 — the gate tells me the rule, the file, and the edge (P1)

As the person fixing it, I want the failure to name which import crossed which boundary, so I do not
have to guess which of four layers moved.

**Independent test:** the four probes (domain→electron, domain→`node:fs`, application→`child_process`,
renderer→adapters) each fail with a distinct rule name and a `from → to` edge.

### US-3 — existing debt would not block the gate (P2)

As the next person to wire a gate in a dirtier repo, I want recorded debt to be tolerated while new
inversions fail, so the gate can land before a refactor.

**Independent test:** `npm run arch:baseline` writes `.dependency-cruiser-known-violations.json`;
`arch:check` passes with a matching baseline and fails when a violation is not in it. Here the baseline
is `[]`, because the tree has no violations.

### US-4 — the check that runs in CI is the check that runs locally (P2)

As a contributor, I want one command, so "green locally" and "green in CI" cannot diverge.

**Independent test:** `npm run arch:check` is the exact command in the `verify` workflow step, and it
pins dependency-cruiser's major so the CI install is not "whatever is current".

## Edge cases

- **A devDependency in the domain.** `electron` resolves as `npm-dev`, so a `dependencyTypes` filter
  let it through on the first attempt. The rule is therefore path-based: `src/domain` may import
  `src/domain` and nothing else.
- **`node:path` in the application layer.** Allowed. Path arithmetic on a string is a pure function,
  not I/O; forbidding it would push a pure helper into an adapter for no gain. `node:fs`,
  `node:child_process`, `node:os`, sockets, and `electron` are forbidden there.
- **A file that only `require`s for its side effect.** Counted. The gate reads the import graph, not
  intent.
- **`test/`, `build/`, `docs/`, `assets/`, `.github/`.** Excluded from the cruise: they are not layers.
- **Third-party code.** Not followed (`node_modules` is a `doNotFollow` segment), so a vendored
  dependency's internals can never appear as our violation.
- **Renderer → `src/domain`.** Not forbidden. Pure domain helpers are legal anywhere; the rule is
  that the renderer must not reach the OS layer.

## Requirements

1. **MUST** ship a `.dependency-cruiser.cjs` whose `forbidden` rules encode the layer map: domain
   imports nothing but itself; application never imports adapters, infrastructure, renderer, or
   preload; application never imports `electron` or the I/O built-ins; adapters never import
   infrastructure; renderer never imports adapters or infrastructure; preload never imports
   application, adapters, infrastructure, or renderer; no dependency cycle.
2. **MUST** expose `npm run arch:check` and `npm run arch:baseline`.
3. **MUST** run `npm run arch:check` as a step in `.github/workflows/verify.yml`, replacing the
   `<ARCH_CHECK_CMD>` placeholder the kit ships commented out.
4. **MUST** treat a violation as an error (`severity: "error"`), not a warning, because a warning in a
   log is a rule nobody enforces.
5. **MUST** cruise the current tree at zero violations before the step is uncommented — a gate that
   lands red teaches everyone to ignore it.
6. **MUST NOT** encode a rule the tree cannot already satisfy, and **MUST NOT** carry a baseline entry
   for code that could have been fixed instead.
7. **MUST** record in `.agents/rules/clean-architecture.md` that the gate now exists, replacing the
   "Not wired yet" note, so the doctrine and the mechanism agree.

## Success criteria

- `npm run arch:check` on `main` after merge: exit 0, `38 modules, 50 dependencies cruised`.
- Each of the four probes fails with its named rule (evidence in the PR body).
- `verify` in CI runs the step and is green; the step's log shows the cruise line.
- `check-docs`, `check-plan-home`, `check-algorithm`, `check-spec` and the existing gates stay green in
  the same change.

## Assumptions

- dependency-cruiser 18 is the right tool for this stack (CommonJS JS in an Electron app, no TS
  build): it reads `require()` the same way it reads `import`.
- The layer directories exist and are already correct, so no code change is needed for the gate to be
  green. Verified, not assumed: 38 modules, 0 violations.

## Domain & outside experts

The product domain is consumer desktop file management (a Windows file manager that behaves like macOS
Finder), recorded in `app/foundation/spec.md` with its SME panel. **No outside expert was consulted for
this change and none is claimed** — it is an enforcement mechanism over an existing, already-reviewed
layer map, not a product decision. The people who "asked" are Dustin (owner) and the kit's doctrine:
`clean-architecture.md` prescribes this exact setup as the follow-through on a recorded gap.

## User interviews (simulated, 4 personas)

n/a — no user-facing surface, so no personas to interview. The only people affected are contributors
and agents running the gates; the layer map those personas would react to was already decided and
reviewed in `app/foundation/spec.md`. Inventing persona reactions to a linter would be theater, and a
fabricated quote is worse than an honest skip.

## Open questions

None. `[NEEDS CLARIFICATION]` markers: zero.

## On resolve

Implemented with the plan in this folder; the four probe results and the cruise count are the evidence.
