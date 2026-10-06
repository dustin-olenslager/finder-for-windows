# Architecture

Decisions and their reasoning. Not a description of the code — the code describes itself. Record a
decision here when a future reader would otherwise ask "why is it like this?" and be tempted to
change it back.

## System shape

_Not written yet — the app has no code. This section is filled by the first plan that builds the
skeleton (`docs/agents/app/foundation/plan.md`), and it must state the four layers, the ports, and the
composition root. Until then the authoritative shape is the layer map in `AGENTS.md` → "Layers" and
`.agents/rules/clean-architecture.md` → "This project's layers"._

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
