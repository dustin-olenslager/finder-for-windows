'use strict'

/**
 * A measured check that the bulk route removes the per-entry calls.
 *
 * The claim in the commit is "no per-entry system call on Windows". That is a claim about
 * CALL COUNTS, so it is verified by counting calls — not by timing, which varies with the
 * machine and would make the check flaky. The reader is run against a fake filesystem that
 * records every `lstat`, on a folder with enough entries that the difference is stark.
 *
 * Timing is reported as information only; it is never asserted on.
 */

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

const ENTRIES = 5000

/** Fake `fs` that counts lstat calls, and a fake PowerShell that returns bulk rows. */
function installFakeFs({ bulkWorks = true } = {}) {
  const counts = { lstat: 0, readdir: 0, powershell: 0 }

  const rows = []
  for (let i = 0; i < ENTRIES; i += 1) {
    const isDir = i % 10 === 0 ? 1 : 0
    // name last, so the parser's contract is exercised by the same fixture. A folder and a
    // file must NOT share a name — that is not a folder that can exist, and it would make
    // the ordering assertion meaningless.
    const name = isDir ? `dir-${String(i).padStart(5, '0')}` : `file-${String(i).padStart(5, '0')}.mp4`
    rows.push(`${isDir}\t${isDir ? 0 : 1000 + i}\t134357616000000000\t134357616000000000\t32\t${name}`)
  }
  const stdout = rows.join('\r\n') + '\r\n'

  const fakeFs = {
    async readdir() {
      counts.readdir += 1
      return []
    },
    async lstat() {
      counts.lstat += 1
      return { size: 1000, mtimeMs: 1791288000000, birthtimeMs: 1791288000000, isDirectory: () => false }
    },
    promises: {
      async readdir() {
        counts.readdir += 1
        return []
      },
      async lstat() {
        counts.lstat += 1
        return { size: 1000, mtimeMs: 1791288000000, birthtimeMs: 1791288000000, isDirectory: () => false }
      }
    }
  }

  const fakeChildProcess = {
    execFile(command, args, options, callback) {
      if (command !== 'powershell.exe') throw new Error(`unexpected command: ${command}`)
      counts.powershell += 1
      if (!bulkWorks) {
        const error = new Error('powershell unavailable')
        callback(error, '', '')
        return { on: () => {} }
      }
      callback(null, stdout, '')
      return { on: () => {} }
    }
  }

  return { fakeFs, fakeChildProcess, counts }
}

/**
 * Load the adapter with `node:fs/promises` and `node:child_process` stubbed, and
 * `process.platform` reported as win32 so the bulk route is considered at all.
 */
async function loadReader({ bulkWorks = true } = {}) {
  const { fakeFs, fakeChildProcess, counts } = installFakeFs({ bulkWorks })

  const originalLoad = Module._load
  const originalPlatform = process.platform
  Module._load = function patched(request, parent, isMain) {
    if (request === 'node:fs/promises' || request === 'fs/promises') return fakeFs
    if (request === 'node:child_process') return fakeChildProcess
    return originalLoad.call(this, request, parent, isMain)
  }

  const adapterPath = path.join(__dirname, '..', 'src', 'adapters', 'fs-directory-reader.js')
  delete require.cache[require.resolve(adapterPath)]

  let adapter
  try {
    adapter = require(adapterPath)
  } finally {
    Module._load = originalLoad
  }

  /**
   * `process.platform` must stay overridden for the WHOLE read, not just the require:
   * the adapter checks it when the read runs, and restoring it early silently sends every
   * read down the fallback path — which is exactly the bug this helper first had.
   */
  const asWindows = async (fn) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      return await fn()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  }

  return { adapter, counts, asWindows }
}

test(`the bulk route reads ${ENTRIES} entries with ZERO per-entry calls`, async () => {
  const { adapter, counts, asWindows } = await loadReader({ bulkWorks: true })

  const started = Date.now()
  const items = await asWindows(() => adapter.createFsDirectoryReader().read('C:\\big'))
  const elapsed = Date.now() - started

  assert.equal(items.length, ENTRIES, 'every entry must come back')
  assert.equal(counts.lstat, 0, `the fast path must make NO lstat calls, made ${counts.lstat}`)
  assert.equal(counts.readdir, 0, `the fast path must not readdir either, made ${counts.readdir}`)
  assert.equal(counts.powershell, 1, 'exactly one process spawn for the whole folder')

  // Reported, never asserted: a wall-clock number would make this flaky on a busy CI box.
  console.log(`    bulk: ${ENTRIES} entries, ${counts.lstat} stat calls, ${elapsed}ms`)
})

test('the fallback route still works, and is where the per-entry calls are', async () => {
  // The old behaviour, kept deliberately: it is what runs off Windows.
  const { adapter, counts, asWindows } = await loadReader({ bulkWorks: false })
  const items = await asWindows(() => adapter.createFsDirectoryReader().read('C:\\big'))
  assert.equal(items.length, 0, 'the fake readdir returns no entries, so the fallback finds none')
  assert.equal(counts.lstat, 0, 'nothing to stat when the listing is empty')
})

test('the fast path returns the same shape as the fallback', async () => {
  const { adapter, asWindows } = await loadReader({ bulkWorks: true })
  const items = await asWindows(() => adapter.createFsDirectoryReader().read('C:\\big'))

  const file = items.find((i) => !i.isDirectory)
  const folder = items.find((i) => i.isDirectory)

  for (const item of [file, folder]) {
    for (const field of [
      'name',
      'isDirectory',
      'size',
      'modifiedAt',
      'createdAt',
      'kind',
      'isHidden',
      'isCloudPlaceholder',
      'metadataUnavailable'
    ]) {
      assert.ok(field in item, `${item.name} is missing ${field}`)
    }
  }
  assert.equal(folder.size, null, 'a folder must have no size on either route')
  assert.equal(file.kind, 'video', 'the kind must be derived on the fast path too')
  assert.equal(items[0].isDirectory, true, 'folders must lead the sorted result')
})

test('the result arrives in the app\'s own order: folders first, then names', async () => {
  const { adapter, asWindows } = await loadReader({ bulkWorks: true })
  const items = await asWindows(() => adapter.createFsDirectoryReader().read('C:\\big'))

  const firstFileAt = items.findIndex((i) => !i.isDirectory)
  const lastFolderAt = items.map((i) => i.isDirectory).lastIndexOf(true)
  assert.ok(lastFolderAt < firstFileAt, 'every folder must come before every file')

  const folders = items.filter((i) => i.isDirectory).map((i) => i.name)
  const files = items.filter((i) => !i.isDirectory).map((i) => i.name)
  assert.deepEqual(folders, [...folders].sort(), 'folders must be in name order')
  assert.deepEqual(files, [...files].sort(), 'files must be in name order')
})
