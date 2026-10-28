/**
 * Architecture boundaries for finder-for-windows — the mechanical half of
 * `.agents/rules/clean-architecture.md`.
 *
 * The layer map is the one AGENTS.md commits to:
 *
 *   src/domain          entities, value types, invariants        (innermost)
 *   src/application     one unit per operation, declares its ports
 *   src/adapters        port implementations, IPC handlers
 *   src/infrastructure  Electron main, filesystem, composition root (outermost)
 *   src/renderer        UI — reaches the main process over IPC only
 *   src/preload         the bridge between the two
 *
 * Everything here is `severity: error`: a violation fails `npm run arch:check`, which runs in
 * required CI. Existing debt would be recorded in `.dependency-cruiser-known-violations.json`
 * (via `npm run arch:baseline`) so the check fails on NEW inversions without demanding a
 * refactor first — that file does not exist today because the tree has no violations.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "A cycle means no layer ordering exists at all — the premise is broken.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // The domain is the innermost layer: pure logic, no framework, no filesystem, no Electron.
    // Path-based, not dependencyTypes-based: a devDependency (`electron`) resolves as
    // `npm-dev`, so a type filter silently let it through. "Imports nothing but itself" is the
    // rule the layer map actually states, and it catches built-ins, packages and outer layers
    // in one sentence.
    {
      name: "domain-stays-pure",
      comment:
        "src/domain imports nothing but src/domain. A domain file that needs `fs`, `path`, Electron, or an adapter has a detail in it that belongs outside the innermost layer.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { pathNot: "^src/domain/" },
    },

    // The application layer may use the domain and declare ports; it may not reach outward.
    {
      name: "application-no-outer-layer",
      comment:
        "src/application must not import adapters, infrastructure, renderer or preload. It declares a port; the adapter implements it.",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/(adapters|infrastructure|renderer|preload)/" },
    },
    {
      name: "application-no-io-or-framework",
      comment:
        "src/application may not touch the filesystem, spawn processes, open a socket, or import Electron. `node:path` is allowed: string arithmetic on a path is a pure function, not I/O.",
      severity: "error",
      from: { path: "^src/application/" },
      to: {
        path: "^(electron|(node:)?(fs|fs/promises|child_process|os|net|http|https|dns))$",
      },
    },

    // Adapters sit at the edge but below the composition root — wiring is infrastructure's job.
    {
      name: "adapters-no-infrastructure",
      comment:
        "src/adapters must not import src/infrastructure. The composition root wires adapters into use cases; an adapter that imports it can only run inside one particular host.",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/infrastructure/" },
    },

    // The UI half of the app reaches the main process over IPC, never by importing it.
    {
      name: "renderer-no-inner-layers",
      comment:
        "src/renderer must not import adapters or infrastructure. A renderer that imports `fs` has moved the filesystem into the UI process.",
      severity: "error",
      from: { path: "^src/renderer/" },
      to: { path: "^src/(adapters|infrastructure)/" },
    },
    {
      name: "preload-no-inner-layers",
      comment:
        "src/preload must not import application, adapters, infrastructure or renderer — it exposes a narrow bridge and nothing else.",
      severity: "error",
      from: { path: "^src/preload/" },
      to: { path: "^src/(application|adapters|infrastructure|renderer)/" },
    },
  ],

  options: {
    // Segment-anchored on purpose: an unanchored `node_modules` would also retire a tracked
    // source whose name merely contains it, which silently removes files from the cruise.
    doNotFollow: { path: "(^|/)node_modules(/|$)" },
    exclude: { path: "^(test|build|assets|docs|\\.github)(/|$)" },
  },
};
