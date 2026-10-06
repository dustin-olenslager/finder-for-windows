# Completed Features

The shipped log. One entry per feature, newest first. Read this before proposing work — it is the
cheapest way to avoid rebuilding something that already exists.

Add an entry when a feature is tested and signed off, at the same time you move its folder into
`<area>/completed/`.

## Entry format

```markdown
### <Feature name> — YYYY-MM-DD
- **What shipped:** one or two sentences, in terms of what a user or caller can now do.
- **Area:** `<area>`
- **Archived plan:** `<area>/completed/<feature>/<renamed-file>.md`
- **Notable decisions:** anything that constrains future work; link the ADR in `architecture.md`.
- **Known gaps:** what was deliberately left out, so the next person does not read it as a bug.
```

---

### Panoply kit adaptation + docs/agents plan spine — 2026-10-06

- **What shipped:** the governance kit is adapted to this project, not just copied in. `AGENTS.md` is
  the project's own hub (under 120 lines): the read-order contract, the STRICT change-approval rule,
  the stack and command table, the filled four-layer map (`src/domain` / `src/application` /
  `src/adapters` / `src/infrastructure`, all marked `target:`), and the enforcement status. Eight
  rule modules that do not apply were pruned, every placeholder token and module fence was resolved, and
  the tool mirrors were regenerated. `docs/agents/` now carries the plan spine — roadmap, queue,
  worklog, completed log, architecture, key-patterns — so any agent in any tool has a place to read
  and write plans.
- **Area:** `governance`
- **Archived plan:** n/a — the adapt runbook is the method (`.agents/commands/adapt-agents-setup.md`);
  there was no plan doc for this batch and the repo predates its own spine.
- **Notable decisions:** the architecture-enforcement block was dropped because no dependency-boundary linter exists yet —
  the required setup is written into `clean-architecture.md` → "Enforcement — the gate, not just the
  checklist" instead of pretending a gate runs. the agent-readiness rule module and `check-agent-readiness.sh` were
  deleted: nothing consumes this app as an agent, and a gate for a surface that does not exist is a
  bluff. The endpoint-coverage scaffold was declined (no HTTP/RPC surface); the coverage block in
  `testing.md` was rewritten to target-mode, per-IPC-channel wording. The design reference is macOS
  Finder itself, which makes the UI rules enforceable rather than decorative.
- **Known gaps:** branch protection is NOT wired — `scripts/init-repo-protection.sh` has not been run,
  so enforcement is ADVISORY until it is (tracked in `in-progress.md` → Blocked). No architecture
  linter, no IPC coverage check, and no `package.json` yet; all three are in `roadmap.md` → Next.

---
