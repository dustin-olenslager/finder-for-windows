'use strict'

/**
 * What happens when the destination already holds that name.
 *
 * The rule this file exists to protect: **nothing is ever overwritten**. Every branch below
 * either leaves the existing file untouched or refuses; none of them destroys data. A
 * "Replace" option would be the one destructive branch in the app, and it is deliberately
 * absent — adding it is the owner's decision, not a convenience to slip in.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { transferFiles } = require('../src/application/transfer-files')

/**
 * A fake filesystem holding a set of existing paths, recording what was written.
 */
function fakeFs({ existing = [], names = {} } = {}) {
  const present = new Set(existing.map((p) => p.toLowerCase()))
  const copied = []
  const moved = []
  return {
    copied,
    moved,
    fileOperations: {
      async exists(target) {
        return present.has(String(target).toLowerCase())
      },
      async listNames(dir) {
        return names[String(dir).toLowerCase()] || []
      },
      async copy(from, to) {
        copied.push([from, to])
        present.add(String(to).toLowerCase())
      },
      async rename(from, to) {
        moved.push([from, to])
        present.add(String(to).toLowerCase())
      },
      async mkdir() {},
      async trash() {}
    }
  }
}

const request = (over = {}) => ({
  op: 'copy',
  items: [{ name: 'Take 1.mp4', path: 'C:\\Shots\\Take 1.mp4' }],
  destination: 'C:\\Archive',
  ...over
})

test('the default still refuses rather than overwriting', async () => {
  const fs = fakeFs({ existing: ['C:\\Archive\\Take 1.mp4'] })
  const result = await transferFiles({ fileOperations: fs.fileOperations }, request())

  assert.equal(result.ok, false)
  assert.equal(result.moved, 0)
  assert.equal(fs.copied.length, 0, 'nothing may be written over an existing file')
  assert.match(result.error, /already an item named/)
})

test('skip leaves the existing file alone and says it skipped', async () => {
  const fs = fakeFs({ existing: ['C:\\Archive\\Take 1.mp4'] })
  const result = await transferFiles({ fileOperations: fs.fileOperations }, request({ onConflict: 'skip' }))

  assert.equal(fs.copied.length, 0, 'skip must not write')
  assert.deepEqual(result.skipped, ['Take 1.mp4'])
  assert.equal(result.moved, 0)
  assert.equal(result.ok, true, 'a skip is not a failure')
})

test('keep-both brings it in under a free name instead of clobbering', async () => {
  const fs = fakeFs({
    existing: ['C:\\Archive\\Take 1.mp4'],
    names: { 'c:\\archive': ['Take 1.mp4'] }
  })
  const result = await transferFiles({ fileOperations: fs.fileOperations }, request({ onConflict: 'keep-both' }))

  assert.equal(fs.copied.length, 1)
  assert.equal(fs.copied[0][1], 'C:\\Archive\\Take 1 2.mp4', 'the new name is free in the destination')
  assert.equal(result.moved, 1)
  assert.equal(result.ok, true)
})

test('keep-both keeps counting up past names that are also taken', async () => {
  const fs = fakeFs({
    existing: ['C:\\Archive\\Take 1.mp4', 'C:\\Archive\\Take 1 2.mp4', 'C:\\Archive\\Take 1 3.mp4'],
    names: { 'c:\\archive': ['Take 1.mp4', 'Take 1 2.mp4', 'Take 1 3.mp4'] }
  })
  await transferFiles({ fileOperations: fs.fileOperations }, request({ onConflict: 'keep-both' }))

  assert.equal(fs.copied[0][1], 'C:\\Archive\\Take 1 4.mp4')
})

test('the free name is chosen from the DESTINATION, not the source', async () => {
  // "Take 2.mp4" exists in the source folder but not in the destination, so the name is
  // free and must be used as-is. Reading the source instead would invent "Take 2 2.mp4".
  const fs = fakeFs({
    existing: ['C:\\Shots\\Take 2.mp4'],
    names: { 'c:\\archive': [] }
  })
  const result = await transferFiles(
    { fileOperations: fs.fileOperations },
    request({ items: [{ name: 'Take 2.mp4', path: 'C:\\Shots\\Take 2.mp4' }], onConflict: 'keep-both' })
  )

  assert.equal(result.moved, 1)
  assert.equal(fs.copied[0][1], 'C:\\Archive\\Take 2.mp4')
})

test('no conflict means the plain path is used, whatever the mode', async () => {
  for (const onConflict of ['refuse', 'skip', 'keep-both']) {
    const fs = fakeFs()
    const result = await transferFiles({ fileOperations: fs.fileOperations }, request({ onConflict }))
    assert.equal(fs.copied[0][1], 'C:\\Archive\\Take 1.mp4', `${onConflict} must not rename an uncontested file`)
    assert.equal(result.moved, 1)
  }
})

test('an unknown conflict mode falls back to the safe one', async () => {
  const fs = fakeFs({ existing: ['C:\\Archive\\Take 1.mp4'] })
  const result = await transferFiles({ fileOperations: fs.fileOperations }, request({ onConflict: 'replace' }))

  assert.equal(fs.copied.length, 0, 'an unrecognised mode must never overwrite')
  assert.equal(result.ok, false)
})

test('a mixed batch reports each outcome separately', async () => {
  const fs = fakeFs({
    existing: ['C:\\Archive\\B.mp4'],
    names: { 'c:\\archive': ['B.mp4'] }
  })
  const result = await transferFiles(
    { fileOperations: fs.fileOperations },
    request({
      items: [
        { name: 'A.mp4', path: 'C:\\Shots\\A.mp4' },
        { name: 'B.mp4', path: 'C:\\Shots\\B.mp4' }
      ],
      onConflict: 'keep-both'
    })
  )

  assert.equal(result.moved, 2)
  assert.equal(result.total, 2)
  assert.deepEqual(fs.copied.map((c) => c[1]), ['C:\\Archive\\A.mp4', 'C:\\Archive\\B 2.mp4'])
})

test('keep-both does not report a rename it did not do', async () => {
  const fs = fakeFs()
  const result = await transferFiles({ fileOperations: fs.fileOperations }, request({ onConflict: 'keep-both' }))

  assert.equal(result.results[0].renamed, undefined, 'an uncontested file is not "renamed"')
})
