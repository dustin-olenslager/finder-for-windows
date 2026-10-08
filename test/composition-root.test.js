'use strict'

/**
 * The composition root, actually loaded.
 *
 * Why this file exists: every other test exercises a use case, an adapter, or the
 * renderer against a STUBBED bridge. None of them loads `src/infrastructure/main.js`, so
 * none of them can see a reference to something that does not exist in it. That is
 * exactly how an undefined `transferFiles` — a missing `require` — reached a release
 * candidate: the feature was covered end-to-end in the UI harness (which stubs the
 * bridge), and the one file that wires the real thing was never executed by any test.
 *
 * Electron cannot run in CI on this project's Linux builders, so `electron` is stubbed
 * here. The stub is deliberately minimal but STRICT: it provides only what the
 * composition root genuinely uses, and each IPC channel the renderer can call is
 * invoked for real. A missing require, a typo in a handler name, or a use case that
 * throws on construction all surface as a failure here.
 */

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

/** Channels the renderer can call. Kept explicit so a NEW channel must be added here. */
const EXPECTED_CHANNELS = [
  'list-directory',
  'get-sidebar',
  'start-folder',
  'join-path',
  'parent-path',
  'path-segments',
  'get-preview',
  'file-operation',
  'transfer',
  'search',
  'index-status',
  'build-index',
  'cancel-index',
  'list-tags',
  'tag-item',
  'untag-item',
  'copy-text',
  'set-zoom',
  'watch-folders',
  'reveal-in-explorer',
  'open-with-default'
]

/**
 * Load main.js with `electron` and the filesystem-facing adapters stubbed, and return
 * the IPC handlers it registered.
 *
 * The module is loaded once per call with a fresh cache entry, because registering the
 * same `ipcMain.handle` channel twice throws — which is itself a useful thing to catch.
 */
function loadMain() {
  const handlers = new Map()
  const windows = []

  const electronStub = {
    app: {
      whenReady: () => Promise.resolve(),
      on: () => {},
      getPath: (name) => (name === 'home' ? 'C:\\Users\\test' : '/tmp/ffw-test-data'),
      getVersion: () => '0.0.0-test',
      setJumpList: () => {},
      quit: () => {}
    },
    BrowserWindow: Object.assign(
      function BrowserWindow() {
        const win = {
          webContents: { send: () => {}, on: () => {}, setWindowOpenHandler: () => {} },
          on: () => {},
          once: () => {},
          loadFile: () => {},
          isDestroyed: () => false,
          show: () => {},
          setProgressBar: () => {},
          // Window geometry: the tracker reads these on every resize/move and again on
          // close, so the stub has to be able to answer.
          getBounds: () => ({ x: 0, y: 0, width: 1180, height: 760 }),
          getNormalBounds: () => ({ x: 0, y: 0, width: 1180, height: 760 }),
          isMaximized: () => false,
          maximize: () => {},
          removeAllListeners: () => {}
        }
        windows.push(win)
        return win
      },
      { getAllWindows: () => windows }
    ),
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: () => {} },
    shell: {
      trashItem: async () => {},
      openExternal: async () => {},
      openPath: async () => '',
      showItemInFolder: () => {}
    },
    clipboard: { writeText: () => {}, readText: () => '' },
    // The composition root validates a restored window position against the real display
    // list, because a saved position for an unplugged monitor opens the window off screen.
    screen: {
      getAllDisplays: () => [
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
      ]
    },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) }
  }

  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronStub
    // The index walker is the one adapter that touches the WHOLE machine. Stubbing it
    // keeps this test from starting a real multi-minute scan of the build host, which is
    // not what any of these checks are about.
    if (/fs-index-walker$/.test(request)) {
      return { createFsIndexWalker: () => ({ walk: async () => ({ files: [] }) }) }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const mainPath = path.join(__dirname, '..', 'src', 'infrastructure', 'main.js')
  delete require.cache[require.resolve(mainPath)]

  try {
    require(mainPath)
  } finally {
    Module._load = originalLoad
  }

  // `app.whenReady()` resolves on a microtask, and the handlers are registered inside it.
  return new Promise((resolve) => {
    setImmediate(() => resolve({ handlers, windows }))
  })
}

test('the composition root loads without a reference error', async () => {
  // This is the check that would have caught the missing `transfer-files` require: the
  // module body runs, and every name it closes over must exist.
  const { handlers } = await loadMain()
  assert.ok(handlers.size > 0, 'main.js registered no IPC handlers at all')
})

test('every channel the renderer can call is registered', async () => {
  const { handlers } = await loadMain()
  const missing = EXPECTED_CHANNELS.filter((channel) => !handlers.has(channel))
  assert.deepEqual(missing, [], `these channels are never registered: ${missing.join(', ')}`)
})

test('the transfer channel reaches the real use case, not an undefined name', async () => {
  // The specific regression. Calling the handler must produce the use case's own
  // validation error — which proves the function was found and ran. A missing require
  // throws "transferFiles is not a function" instead.
  const { handlers } = await loadMain()
  const transfer = handlers.get('transfer')
  assert.equal(typeof transfer, 'function')

  const result = await transfer({}, { op: 'copy', items: [], destination: null })
  assert.equal(result.ok, false)
  assert.match(result.error, /destination folder is required/i, `got: ${JSON.stringify(result)}`)
})

test('the transfer channel refuses an empty selection rather than reporting success', async () => {
  const { handlers } = await loadMain()
  const result = await handlers.get('transfer')({}, { op: 'copy', items: [], destination: 'C:\\dst' })
  assert.equal(result.ok, false)
  assert.match(result.error, /Nothing to transfer/i)
})

test('the file-operation channel is reachable and validates its input', async () => {
  const { handlers } = await loadMain()
  const result = await handlers.get('file-operation')({}, { op: 'trash', path: null })
  assert.equal(result.ok, false, 'a missing path must not report success')
})

test('the watch-folders channel reports how many folders it is watching', async () => {
  const { handlers } = await loadMain()
  const result = await handlers.get('watch-folders')({}, ['C:\\Users\\test'])
  assert.equal(result.ok, true)
  assert.equal(result.watching, 1)
})

test('the path channels agree with each other through the real wiring', async () => {
  // The renderer builds paths only through these channels, so they must be consistent
  // with one another in the real composition root — not just in the domain unit tests.
  const { handlers } = await loadMain()
  const joined = await handlers.get('join-path')({}, 'C:\\Users\\test', 'Videos')
  assert.equal(joined, 'C:\\Users\\test\\Videos')

  const parent = await handlers.get('parent-path')({}, joined)
  assert.equal(parent, 'C:\\Users\\test')

  const segments = await handlers.get('path-segments')({}, joined)
  assert.deepEqual(segments, ['C:\\', 'Users', 'test', 'Videos'])
})

test('no handler throws on being called with no arguments at all', async () => {
  // The renderer is not the only caller: a bug in the preload, or a stale renderer
  // against a newer main, sends `undefined`. A handler that throws an opaque TypeError
  // is much harder to diagnose than one that returns a plain refusal.
  //
  // `build-index` is EXCLUDED on purpose: calling it starts a real scan of the machine,
  // which takes minutes and is not what this test is about. It is checked separately
  // below, where the scan is stopped immediately.
  const LONG_RUNNING = new Set(['build-index'])

  const { handlers } = await loadMain()
  const threw = []
  for (const [channel, fn] of handlers) {
    if (LONG_RUNNING.has(channel)) continue
    try {
      await fn({}, undefined)
    } catch (error) {
      threw.push(`${channel}: ${error.message}`)
    }
  }
  assert.deepEqual(threw, [], `these channels throw instead of refusing: ${threw.join(' | ')}`)
})

test('build-index survives a missing sender without starting an unbounded scan', async () => {
  // The regression: the progress callback dereferenced `event.sender` unconditionally, so
  // a call with no webContents threw "Cannot read properties of undefined (reading
  // 'isDestroyed')" — and because the scan is started BEFORE the first progress callback,
  // the throw also left a whole-machine scan running with nothing able to stop it.
  const { handlers } = await loadMain()
  const buildIndex = handlers.get('build-index')
  assert.equal(typeof buildIndex, 'function')

  const result = await buildIndex({}, undefined)
  // Whatever it reports, it must REPORT — not throw.
  assert.ok(result === undefined || typeof result === 'object', `unexpected return: ${result}`)
})
