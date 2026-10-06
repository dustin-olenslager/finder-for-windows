# Code Style & Patterns

> **Applies when:** always — any project in which an agent reads, writes, or edits source code.
> **Delete this file (and its `@` import in the generated agent hub) if:** never. Trim individual rules instead.

## Before you write code

- Read the existing code in the area you are about to change, before changing it. The patterns already in use beat the ones you would pick fresh, and matching them keeps review cheap.
- Prefer editing an existing file over creating a new one. Create a file only when the code carries a genuinely new responsibility — otherwise you fragment what a reader has to hold in their head.
- **Where a new file goes is a layer question before it is a folder question.** Decide first whether the code is a domain rule, a use case, an adapter, or framework wiring (see `clean-architecture.md`); the folder follows from that answer. Picking the folder by resemblance is how business rules end up living inside a controller.
- Do not add features, refactors, renames, or "improvements" beyond what was requested. Unrequested changes bury the requested one in the diff and force the reviewer to re-review working code.
- When adding a new entity, endpoint, screen, or job, follow the structure of the closest existing one — same folder, same layering, same naming. "It matches the neighbouring code" is a checkable standard; "it's cleaner" is not.

## Structure

- **One responsibility per file.** A file that renders a view *and* fetches data *and* formats currency has three reasons to change and cannot be tested or reused in pieces. Split it.
- **Three similar lines beat a premature abstraction.** Duplicate until the shape of the variation is actually known; an abstraction built from one example encodes an accident as a rule and is harder to unwind than the duplication was.
- Keep call depth shallow. If a change requires editing four files to add one field, the layering is the bug — say so rather than adding a fifth.

## Import direction

- **An import that points outward is a style violation, and it is visible in the diff.** Source-code dependencies point inward only (see `clean-architecture.md`), so a domain or use-case file importing an ORM, HTTP framework, UI library, or vendor SDK is wrong on sight — a reviewer can catch it from the import block alone, with no test run and no debate.
- When inner code needs something outer code owns, the inner layer declares the interface (the port) and the outer layer implements it (the adapter). Do not add the outward import "for now": that is the import that never gets removed, and it silently makes the inner layer unusable without the outer one.

## Constants and typed values

- **No magic strings or magic numbers.** Any value compared, switched on, or stored (statuses, roles, event names, kinds, feature keys) comes from the project's shared enum/constant module — see the table below. Inline literals drift between producer and consumer, and the compiler/linter cannot catch the drift.
- When you need a new status or kind, add it to the shared module first, then use it. Never introduce it as a literal "just for now."
- Shared types and constants are declared once and imported. Two definitions of the same union will diverge.

## Use the project's own wrappers

Those wrappers are the adapters that sit between your code and the Details it depends on. Call the adapter; never reach past it to the thing behind it — reaching past is exactly how a Detail escapes its layer.

- **Never call a raw IPC channel from feature code.** Use the preload bridge the project exposes — it centralizes channel names, argument validation, error shaping, and response typing, and a raw `ipcRenderer.invoke` silently opts out of all four (and breaches context isolation).
- Same rule for filesystem access: go through the project's filesystem port/adapter rather than calling `fs` directly in a handler or component, so that path handling, error mapping, and permissions stay in one place.
- If the wrapper genuinely cannot express what you need, extend the wrapper and say so — do not bypass it locally.

## Project conventions

| Convention | This project's rule |
| --- | --- |
| Module system | CommonJS in the main process — `require` / `module.exports`; no ESM in main. |
| Formatter / linter that decides mechanical style | `npm run format` (writes) · `npm run lint` (checks) |

Mechanical style (quotes, semicolons, line width, import order) is whatever the formatter emits. Do not hand-argue formatting; run `npm run format`.

**Rows deleted at adapt time** — export style, import alias, shared-constants location, file/symbol
naming, the boundary wrapper, and the data-access layer. The app's source tree does not exist yet, so
none of them had a *verified* value, and a guessed convention is worse than an absent one because the
next agent follows it. Add each row back the moment the convention is real.

## Dead code cleanup

Removing a caller is only half the change. When your edit removes the **last** reference to something, remove the thing too, in the same change:

- Removed the last navigation into a view/route/screen? Delete the route entry, the view component, and its state branch. An unreachable view still costs bundle size, test time, and reader attention, and it rots into a broken page nobody notices.
- Removed the last call site of an endpoint? Delete the endpoint, its handler, and its test.
- Removed the last import of an exported function, type, or constant? Delete the export.
- Removed the last consumer of a feature flag, config key, or environment variable? Delete it from the config and the deployment docs.

Before deleting, search the whole repo for the symbol (including string references and dynamic lookups) to confirm it is truly the last one. If a reference exists only in a test that tests nothing else, the test goes too. If you are unsure whether something is reachable, say so and ask — do not leave it silently orphaned.
