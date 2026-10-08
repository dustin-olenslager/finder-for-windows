'use strict'

/**
 * Real file-type icons, and the two claims that make them affordable.
 *
 * The whole reason this adapter exists is that it does NOT ask the shell once per file: a
 * folder of 5,000 videos must cost ONE lookup. That is a performance claim, so it is
 * asserted by COUNTING CALLS rather than by timing — the same approach the bulk-enumeration
 * test uses, and for the same reason: a wall-clock threshold is flaky on a busy box.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createFileIconProvider, FOLDER_KEY, NO_EXTENSION_KEY } = require('../src/adapters/electron-file-icons')

/** A fake shell that counts what it was asked, and can be told to fail. */
function fakeShell({ fail = false } = {}) {
  const asked = []
  return {
    asked,
    app: {
      async getFileIcon(target) {
        asked.push(target)
        if (fail) throw new Error('the shell said no')
        return { isEmpty: () => false, toDataURL: () => `data:image/png;base64,ICON(${target})` }
      }
    }
  }
}

test('every file of one type costs a single shell lookup', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  const urls = []
  for (const name of ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.MP4']) {
    urls.push(await icons.forPath(`C:\\Videos\\${name}`, false))
  }

  assert.equal(shell.asked.length, 1, 'five .mp4 files must ask the shell once')
  assert.equal(new Set(urls).size, 1, 'every .mp4 resolves to the same icon')
  assert.equal(icons.size(), 1, 'one cache entry for the type')
})

test('the cache key is the extension, so the query is case-insensitive', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  await icons.forPath('C:\\a\\one.MP4', false)
  await icons.forPath('C:\\a\\two.mp4', false)

  assert.equal(shell.asked.length, 1, '.MP4 and .mp4 are the same file type')
})

test('different types are different lookups', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  await icons.forPath('C:\\a\\clip.mp4', false)
  await icons.forPath('C:\\a\\photo.png', false)
  await icons.forPath('C:\\a\\notes.txt', false)

  assert.equal(shell.asked.length, 3)
  assert.equal(icons.size(), 3)
})

test('folders share one lookup regardless of which folder it is', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  await icons.forPath('C:\\Users\\dustin', true)
  await icons.forPath('C:\\Users\\dustin\\Videos', true)
  await icons.forPath('D:\\Projects', true)

  assert.equal(shell.asked.length, 1, 'a folder icon is a folder icon')
})

test('a file with no extension is not treated as one', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  await icons.forPath('C:\\a\\README', false)
  await icons.forPath('C:\\a\\LICENSE', false)

  assert.equal(shell.asked.length, 1, 'both land in the no-extension bucket')
  assert.equal(icons.size(), 1)
})

test('an empty path returns null without troubling the shell', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  assert.equal(await icons.forPath('', false), null)
  assert.equal(await icons.forPath(null, false), null)
  assert.equal(await icons.forPath('   ', false), null)
  assert.equal(shell.asked.length, 0)
})

test('a shell that refuses yields null, not a throw', async () => {
  const shell = fakeShell({ fail: true })
  const icons = createFileIconProvider(shell)

  // The caller keeps its own vector glyph. A missing icon is not an error worth showing.
  assert.equal(await icons.forPath('C:\\a\\thing.xyz', false), null)
})

test('an empty image is treated as no answer', async () => {
  const icons = createFileIconProvider({
    app: { async getFileIcon() { return { isEmpty: () => true } } }
  })

  assert.equal(await icons.forPath('C:\\a\\thing.xyz', false), null)
})

test('concurrent requests for one type share a single lookup', async () => {
  const shell = fakeShell()
  const icons = createFileIconProvider(shell)

  // This is the case a naive cache misses: ten rows of the same type are painted together,
  // so all ten ask before any answer has come back.
  const all = await Promise.all(
    Array.from({ length: 10 }, (_, i) => icons.forPath(`C:\\Videos\\clip${i}.mov`, false))
  )

  assert.equal(shell.asked.length, 1, 'ten simultaneous .mov requests must be one call')
  assert.equal(new Set(all).size, 1)
})

test('the exported keys are the ones the renderer looks up', async () => {
  // The renderer builds the same key to find a cached icon. If these strings drift, the
  // listing silently stops swapping icons in and no test would notice.
  assert.equal(FOLDER_KEY, '#folder')
  assert.equal(NO_EXTENSION_KEY, '#none')
})
