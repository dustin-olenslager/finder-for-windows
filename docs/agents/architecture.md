# Architecture

Decisions and their reasoning. Not a description of the code — the code describes itself. Record a
decision here when a future reader would otherwise ask "why is it like this?" and be tempted to
change it back.

## System shape

The app is an Electron desktop application in four layers, with dependencies pointing inward:

```
src/domain          file-item value types, tag rules, view-state rules, query parsing (no I/O)
src/application     the use cases (ListDirectory, …) and the PORT interfaces they declare
src/adapters        port implementations (fs reader, IPC handlers), DTO mappers
src/infrastructure  Electron main, the composition root, config
src/preload         the single bridge between renderer and main
src/renderer        presentation and view state only
```

- **The composition root** is `src/infrastructure/main.js` (`createContainer()`). It is the only
  module that knows both a port and its concrete adapter.
- **Ports implemented so far:** `DirectoryReader` (declared in
  `src/application/ports/directory-reader.js`, implemented by
  `src/adapters/fs-directory-reader.js`).
- **IPC contract:** one channel per use case, invoked through the preload bridge. `list-directory`
  returns `{ ok, path, items }` or `{ ok:false, path, error }` — it never rejects across the boundary,
  so the renderer always has a string to render.

### ADR-0001 — Build on `main` without pull requests

- **Date:** 2026-10-05
- **Status:** Accepted
- **Context:** The repo's standing rule is one branch, one PR, squash-merge. The owner asked for the
  app to be built end-to-end and handed to him as an installer he can test on his own machine. He said
  he did not want more PRs; he later clarified he was not asking for an existing PR to be dropped, only
  that the *whole build* get finished rather than arriving as PR-by-PR review ceremony.
- **Options considered:** (a) keep the branch-and-PR flow and hand him PR links — rejected, that is the
  ceremony he is trying to avoid; (b) drop the kit's gates along with the PRs — rejected, the gates are
  what stop a wrong change; (c) keep every gate and every artifact, and land on `main` directly.
- **Decision:** (c). Commits go to `main` directly; the spec, plan, tests, worklog, and the kit's
  checks still apply on every change. Dropping PR #3 was a consequence of (c), not a request in its own
  right — its content (the plan) was preserved and landed on `main` in `be47cb3`.
- **Consequences:** the review step that a PR provided is gone, so the automated gates and the test
  suite carry that weight. **Revisit when the owner says so** — restore branch + PR and this ADR is
  marked Superseded.

### ADR-0002 — The Windows installer is built by GitHub Actions, not locally

- **Date:** 2026-10-05
- **Status:** Accepted
- **Context:** The dev box is Linux, has no `wine`, and runs as an unprivileged user, so
  `electron-builder` cannot produce the NSIS target there. The owner's machine is Windows on ARM64.
- **Options considered:** (a) install wine — needs root, and wine's reliability for the NSIS + rcedit
  path is poor; (b) build on the owner's machine — he would have to install a toolchain before he can
  test anything; (c) build on a GitHub-hosted Windows runner and publish the artifacts.
- **Decision:** (c). `.github/workflows/build-windows.yml` builds arm64 and x64 in parallel on
  `windows-latest` and uploads both installers and both portable executables. A version tag or a
  manual dispatch runs it.
- **Consequences:** every build costs a CI run, and the artifact only exists once CI finishes — but
  the owner downloads one file and installs it, and no local Windows toolchain is ever required.
  `electron-builder.yml` must keep `publish: null`; without it, electron-builder detects CI and tries
  to publish a release, which fails without a token.

## Boundaries and ownership

- The **main process** owns everything privileged: the filesystem, the OS APIs, window lifecycle. The
  **renderer** owns only presentation and view state, and reaches the main process through the preload
  bridge and nothing else. `nodeIntegration` stays off; `contextIsolation` stays on.
- The preload bridge is the **single typed entry point** from renderer to main. A raw
  `ipcRenderer.invoke` reached around it is the boundary violation this repo must not ship.
- Shared types and constants get one home, declared once and imported — not duplicated per side of the
  bridge. The location is decided by the first plan that needs it.
- **Dependency direction that must not reverse:** `src/domain` ← `src/application` ← `src/adapters` ←
  `src/infrastructure`. Nothing inner imports anything outer.

## Data model

_Not written yet — the app has no persistence. It reads the filesystem, which it does not own, and
must treat every directory as authoritative and every cached listing as a snapshot that can go stale.
If a durable store is ever added, this section records what is core, what is derived, and what is
deliberately denormalized._

## Cross-cutting decisions

- **Error shape:** a domain/use-case failure is a named domain error, translated to a transport shape
  only in the adapter layer — never an Electron error string leaked to the renderer. See
  `.agents/rules/error-handling.md`.
- **No user-facing async operation may fail silently** — every failure surfaces in the UI and is
  logged. `.agents/rules/error-handling.md` is the doctrine; it is the strongest rule in the kit.
- **Not in scope:** any network service, any HTTP/RPC surface, any multi-user or sync feature. This is
  a local-first, single-user desktop app.

---

## ADR template

Copy this block for each decision. Number sequentially; never renumber or delete a superseded ADR —
mark it `Superseded by ADR-NNNN` so the reasoning trail survives.

```markdown
### ADR-0001 — <short decision title>
- **Date:** YYYY-MM-DD
- **Status:** Accepted | Superseded by ADR-NNNN | Reversed
- **Context:** the forces in play — constraints, scale, deadlines, what we knew at the time.
- **Options considered:** each one, with its honest tradeoffs. Include the option we rejected.
- **Decision:** what we chose.
- **Consequences:** what this makes easy, what it makes hard, and what would force a revisit.
```
