# Key Patterns & Gotchas

Conventions to follow and traps to avoid, discovered the expensive way. Add to this file the moment
something surprises you — record the **symptom**, not just the fix, because the next person arrives
holding the symptom.

## Conventions

Patterns that new code must match. Keep each one checkable — a reviewer should be able to point at a
line and say "this violates it."

- **CommonJS in the main process** — `require` / `module.exports`, no ESM in main. Electron's main
  process is the reason this is pinned; a mixed module system in one process is the bug it prevents.
- **The preload bridge is the only renderer→main path.** No component calls `ipcRenderer.invoke`
  directly, and no channel is reached around the typed wrapper.
- **Dependencies point inward only.** A business rule in an IPC handler, a component, or a filesystem
  callback is a layer violation, not a shortcut — see `.agents/rules/clean-architecture.md`.
- **Formatting is whatever `npm run format` emits.** Do not hand-argue style.

## Gotchas

| Symptom you will see | Actual cause | What to do |
|---|---|---|
| _EXAMPLE — tests pass locally, fail in CI with a timeout_ | _CI runs without the local cache warm_ | _Seed the fixture in `beforeAll`, not lazily_ |
| A structural change's plan has no `Deletion candidates` section, so `check-algorithm.sh` refuses the write | Deletion's output is **absence**, so nothing at the end reminds anyone it was skipped | Fill the section from `_templates/plan.md` before retrying. An empty table must be **argued**, not left blank — and a proposal that was considered and **turned down** belongs in the same list (what it was, why it lost, **what we do instead**) |
| `sh scripts/panoply.sh check` reports `placeholders` (exit 13) on a repo you thought was adapted | An adapt-time placeholder token survives somewhere under `AGENTS.md`, `docs/agents/`, or `.agents/rules/` — the kit's own command docs discuss the convention in prose and are excluded; a NAME-like token is not | Grep the three paths for an unfilled double-brace token and fill or delete each hit. Never leave an unfillable token: a token teaches the model to skim the rules that *are* real |
| `sh scripts/sync-agents.sh --check` fails after a rule edit | The mirrors (and `AGENTS.md`'s rules index) are generated, not hand-written | Run `sh scripts/sync-agents.sh` — never hand-edit a mirror or the marked block |
| The same fact is edited in two docs and they disagree | Two homes for one fact | `documentation.md` → "Hygiene": one fact, one home. `completed-features.md` is the feature narrative; `worklog.md` is the change line; `architecture.md` is the reasoning |

## Testing conventions

- **Every IPC channel the preload bridge exposes gets a test in the same change that adds it** — the
  handler (with a fake filesystem port) and the bridge contract (channel name, argument shape, error
  shape). See `.agents/rules/testing.md` → "Coverage discipline — the target state".
- Where tests live and the path mapping are stated in `.agents/rules/testing.md`; the mapping rule is
  mechanical so no test is written in a third place.
- Fake the filesystem through a port, never patch a module path. An adapter test may use a real temp
  directory; a domain/use-case test may not touch disk at all.
- **Never skip, `.only`, or comment out a failing test to get a change through.** Fix it or report it.
- When you change call ordering in a batch, update the mocks in the same change — mocks consumed in
  sequence return the wrong data silently when the order shifts, and the test stays green.

## Performance notes

- **The headline constraint is huge folders.** Listing a directory with hundreds of thousands of
  entries must not block the UI, and must not materialize a DOM node per entry — virtualize past a few
  hundred rows. This is pillar 2 of the project, so it gets a measured number in the first plan, not an
  adjective.
- Directory reads are I/O behind a port, so they are also the natural seam for a test double and for
  cancellation when the user navigates away mid-read.

## Things that look wrong but are intentional

Guard rails against well-meaning "cleanups" that reintroduce a fixed bug. One line each, with the
reason.

- **The four `target:` layer directories are documented and do not exist yet.** That is deliberate —
  see `AGENTS.md` → "Layers". Creating them without a file to put in them is not an improvement.
- **`.cursor/`, `.windsurf/`, `.clinerules/`, `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`, and
  `.github/copilot-instructions.md` are gitignored on purpose.** They are generated from `AGENTS.md` +
  `.agents/rules/`; committing them would create a second copy of the ruleset that drifts.
