# Testing

> **Applies when:** the project has an automated test suite, or is about to get one.
> **Delete this file (and its `@` import in the generated agent hub) if:** the project has no test runner and none is planned.

## Testability is a design signal, not a fixture problem

- **Domain and use-case logic must be testable with no filesystem, no Electron runtime, and no window.** Construct the thing, call it, assert the result. This is the single most reliable check that the Dependency Rule held (see `clean-architecture.md`) — you cannot fake it, because a rule that reaches outward simply will not run without the outer layer.
- **If a test of a business rule needs a real directory, a running Electron process, or a rendered window, that is a design defect the test is reporting.** Fix the design — move the rule inward, put a port where the reach-out is — rather than adding the fixture that makes the symptom go away. The fixture is cheaper today and is the reason the suite is slow in a year.
- Say it out loud when you hit one. "This needed a real filesystem to test, so I extracted a port" is a finding worth reviewing; silently adding infrastructure to a unit test is not.

## The pyramid maps onto the layers

- **Wide, fast base — Entities/Domain and Use Cases/Application.** Pure in-process tests, no I/O, milliseconds each. Most tests live here because most behaviour should. These are the tests you can afford to run after every edit.
- **Middle band — Interface Adapters and Frameworks & Drivers.** Test each adapter against the real thing it adapts: a real temp directory for a filesystem adapter, a real round-trip for an IPC handler, the real serializer for a mapper. An adapter tested against a mock of its own dependency asserts nothing except that you wrote the mock to match your assumption.
- **Thin top — end-to-end.** A handful of paths proving the wiring holds. If you find you need many end-to-end tests before you feel safe, that is evidence business rules are living in the outer layers, where only an end-to-end test can reach them.

## Baseline

- Write unit tests for all business logic: validation, data transformations, calculations, state machines, permission checks, formatting. Logic without a test is a behaviour nobody can change safely later.
- **Run `npm test` after every change**, not just at the end of a task. A failure found one edit later is a two-minute fix; found ten edits later it is a bisect.
- If tests fail, fix the code until they pass before moving on. Report the failure — never continue building on a red suite.
- **Never skip, `.only`, comment out, or delete a failing test to get green.** A skipped test is an untested behaviour plus a false signal, which is worse than no test. If a test is genuinely obsolete because the behaviour was removed, delete it in the same change that removes the behaviour, and say so.
- Do not filter or spot-check the run. Run the full suite, unfiltered, before committing.

## Coverage discipline — the target state

There is **no endpoint-test coverage gate in this repo yet, and this file does not claim one.** The app
has no HTTP or RPC surface; its boundary is the IPC bridge, and the coverage discipline that belongs
here is per-command rather than per-route:

- **Every IPC channel the preload bridge exposes gets a test in the same change that adds it**, on both
  sides — the handler (a unit test with a fake filesystem port) and the bridge contract (the channel
  name, argument shape, and error shape). A channel with no test is an untested capability, exactly as
  an untested route is.
- **Mirror the source tree in the test tree.** A handler at `src/adapters/<path>/<name>.cjs` has its
  test at `test/<path>/<name>.test.cjs` (or colocated as `<name>.test.cjs`, whichever the runner
  collects) — one mechanical mapping, so no judgement call about where a test "should" go.
- **Derive the channel list from the preload manifest**, not from filename patterns: the file that
  registers the exposed channels is the single source of truth, and a filename heuristic produces both
  false positives and silent false negatives.
- **Legacy gaps live in a shrink-only allowlist** once a check exists (`scripts/endpoint-test-allowlist.yaml`),
  and CI refuses net-new entries. Until the check exists, this is a rule followed by discipline and said
  so in the PR — not a green gate.
- **The check to wire, when the surface is real:** a ~30-line script that walks the preload manifest and
  fails on any channel file without a matching test, seeded with the current gaps. Until then, no
  coverage-check command exists and none is asserted.

## Mocking

- **Inject a fake through the port rather than patching a module.** The data layer stays out of the test — no live database, service, or network — because the use case receives its repository/gateway as a dependency and the test hands it an in-memory implementation. Real dependencies make tests order-dependent, environment-dependent, and slow, and they fail for reasons that have nothing to do with the change under review.
- Injection beats patching for a concrete reason: a patch keyed on a module path breaks the moment someone moves the file, and it silently stops patching anything if the path is wrong, while a constructor or parameter argument is checked by the compiler and cannot miss.
- Mock at the boundary the code actually calls (the client module, the repository), not deeper. Mocking internals couples the test to implementation details and it breaks on every refactor. **If there is no port to inject at, that is a finding — record it.** When the code is yours to change in this same effort, add the port. When you are testing existing conventionally-structured code, patching the module at the boundary it calls is an acceptable interim — note the missing port rather than blocking the test on an architecture refactor nobody approved.

### Sequentially-consumed mocks go stale — watch for this

Many mocking styles queue results and hand them out **in call order**. So when you add a query to an existing parallel batch (a `Promise.all`, a concurrent fetch group, a transaction block), the queued mock results shift by one and every downstream assertion is now reading the wrong row.

- After changing the number or order of calls in a batch, **update the mock push order in every affected test file** in the same change.
- The failure mode is silent: tests can still pass while asserting against the wrong data. If a test keeps passing after you changed the query it covers, treat that as a red flag and verify the mock alignment by hand.
- Prefer mocks keyed by argument over positional queues where the framework allows it — they survive reordering.

## Before you commit

- Full test run, unfiltered: `npm test`.
- Verify assertions match any new response shape — dropped fields, renamed fields, changed types — rather than assuming an untouched test still tests what it claims.
