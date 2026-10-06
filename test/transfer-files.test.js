'use strict'

/**
 * TransferFiles: copy or move a selection into a folder.
 *
 * The rules under test are the ones that lose data if they are wrong: never overwrite,
 * never copy a folder into itself, and never report a partial failure as a success.
 */

const test = require('node:test')
const assert = require('node:assert')

const { transferFiles, isInside } = require('../src/application/transfer-files')

/** An in-memory disk with a case-insensitive `exists`, as Windows has. */
function fakeOps({ present = [], fail = null, failFor = null } = {}) {
  const existing = new Set(present)
  return {
    calls: [],
    async copy(from, to) {
      this.calls.push(['copy', from, to])
      if (failFor && from.includes(failFor)) throw Object.assign(new Error('x'), { code: 'EBUSY' })
      if (fail) throw Object.assign(new Error('x'), { code: fail })
      existing.add(to)
    },
    async rename(from, to) {
      this.calls.push(['rename', from, to])
      if (fail) throw Object.assign(new Error('x'), { code: fail })
      existing.delete(from)
      existing.add(to)
    },
    async exists(target) {
      if (existing.has(target)) return true
      const lower = target.toLowerCase()
      return [...existing].some((p) => p.toLowerCase() === lower)
    }
  }
}

test('copy writes each item into the destination', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt', 'C:\\a\\two.txt'] })
  const result = await transferFiles(
    { fileOperations: ops },
    {
      op: 'copy',
      items: [
        { name: 'one.txt', path: 'C:\\a\\one.txt' },
        { name: 'two.txt', path: 'C:\\a\\two.txt' }
      ],
      destination: 'C:\\b'
    }
  )
  assert.equal(result.ok, true)
  assert.equal(result.moved, 2)
  assert.deepEqual(ops.calls, [
    ['copy', 'C:\\a\\one.txt', 'C:\\b\\one.txt'],
    ['copy', 'C:\\a\\two.txt', 'C:\\b\\two.txt']
  ])
})

test('move renames rather than copies, so nothing is duplicated', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'move', items: [{ name: 'one.txt', path: 'C:\\a\\one.txt' }], destination: 'C:\\b' }
  )
  assert.equal(result.ok, true)
  assert.deepEqual(ops.calls, [['rename', 'C:\\a\\one.txt', 'C:\\b\\one.txt']])
})

test('an existing destination item is NEVER overwritten', async () => {
  // This is the rule that matters most: a silent overwrite destroys a file.
  const ops = fakeOps({ present: ['C:\\a\\one.txt', 'C:\\b\\one.txt'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'one.txt', path: 'C:\\a\\one.txt' }], destination: 'C:\\b' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /already an item named/)
  assert.equal(ops.calls.length, 0, 'nothing may be written when the target is taken')
})

test('a case-variant destination still counts as taken, as Windows treats it', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt', 'C:\\b\\ONE.TXT'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'one.txt', path: 'C:\\a\\one.txt' }], destination: 'C:\\b' }
  )
  assert.equal(result.ok, false, 'Windows is case-insensitive, so this is a collision')
  assert.equal(ops.calls.length, 0)
})

test('a folder cannot be copied into itself', async () => {
  const ops = fakeOps({ present: ['C:\\a\\sub'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'sub', path: 'C:\\a\\sub' }], destination: 'C:\\a\\sub' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /cannot be copied into itself/)
  assert.equal(ops.calls.length, 0)
})

test('a folder cannot be copied into its own subtree', async () => {
  const ops = fakeOps({ present: ['C:\\a\\sub'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'sub', path: 'C:\\a\\sub' }], destination: 'C:\\a\\sub\\deeper' }
  )
  assert.equal(result.ok, false, 'copying a folder into itself would recurse forever')
  assert.equal(ops.calls.length, 0)
})

test('a sibling with a shared prefix is not mistaken for the subtree', async () => {
  // C:\a\sub2 is NOT inside C:\a\sub, and a naive startsWith would say it is.
  const ops = fakeOps({ present: ['C:\\a\\sub2'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'sub2', path: 'C:\\a\\sub2' }], destination: 'C:\\a\\sub' }
  )
  assert.equal(result.ok, true, `expected the copy to run, got ${result.error}`)
  assert.equal(ops.calls.length, 1)
})

test('moving an item to the folder it is already in is a no-op success', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'move', items: [{ name: 'one.txt', path: 'C:\\a\\one.txt' }], destination: 'C:\\a' }
  )
  assert.equal(result.ok, true, 'dropping a file where it already lives is not an error')
  assert.equal(ops.calls.length, 0)
  assert.equal(result.moved, 0)
})

test('a partial failure is reported as partial, with the count', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt', 'C:\\a\\two.txt', 'C:\\a\\three.txt'], failFor: 'two.txt' })
  const result = await transferFiles(
    { fileOperations: ops },
    {
      op: 'copy',
      items: [
        { name: 'one.txt', path: 'C:\\a\\one.txt' },
        { name: 'two.txt', path: 'C:\\a\\two.txt' },
        { name: 'three.txt', path: 'C:\\a\\three.txt' }
      ],
      destination: 'C:\\b'
    }
  )
  assert.equal(result.ok, false, 'a partial failure must not report success')
  assert.equal(result.moved, 2)
  assert.match(result.error, /2 of 3 done/)
  assert.match(result.error, /two\.txt/)
})

test('a failure names what to do, never an errno', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt'], fail: 'EACCES' })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'one.txt', path: 'C:\\a\\one.txt' }], destination: 'C:\\b' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /permission/)
  assert.ok(!result.error.includes('EACCES'), 'the raw code must not reach the user')
})

test('a missing destination is refused before anything is written', async () => {
  const ops = fakeOps({ present: ['C:\\a\\one.txt'] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'one.txt', path: 'C:\\a\\one.txt' }] }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /destination folder is required/)
  assert.equal(ops.calls.length, 0)
})

test('an empty selection is refused rather than reported as done', async () => {
  const ops = fakeOps({ present: [] })
  const result = await transferFiles({ fileOperations: ops }, { op: 'copy', items: [], destination: 'C:\\b' })
  assert.equal(result.ok, false)
  assert.match(result.error, /Nothing to transfer/)
})

test('a file with no path is refused, not silently skipped', async () => {
  const ops = fakeOps({ present: [] })
  const result = await transferFiles(
    { fileOperations: ops },
    { op: 'copy', items: [{ name: 'ghost.txt' }], destination: 'C:\\b' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /ghost\.txt/)
})

test('isInside compares case-insensitively and tolerates a trailing separator', () => {
  assert.equal(isInside('C:\\a\\b\\c', 'C:\\A\\B'), true)
  assert.equal(isInside('C:\\a\\b', 'C:\\a\\b'), true)
  assert.equal(isInside('C:\\a\\bc', 'C:\\a\\b'), false)
  assert.equal(isInside('C:\\a\\b', 'C:\\a\\b\\'), true)
})
