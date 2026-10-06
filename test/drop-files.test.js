'use strict'

/**
 * DropFiles: a drag and drop landing on a folder.
 *
 * A drag is the same transfer as copy/paste, with rules of its own that only a drag can
 * reach. These are the ones that lose data or mislead if they are wrong:
 *
 *   - a folder must never be dropped into itself or into its own subtree (the transfer
 *     rules catch the first half; a drop can also target a folder INSIDE the dragged set,
 *     which is the same infinite recursion reached from the other side);
 *   - putting an item back where it already was must be a quiet no-op, not a failure;
 *   - the modifier key decides copy versus move, and the default is move.
 *
 * The fake disk is case-insensitive, as Windows is, because a rule that only passes on a
 * case-sensitive filesystem is not a rule this app can rely on.
 */

const test = require('node:test')
const assert = require('node:assert')

const { dropFiles } = require('../src/application/transfer-files')

function fakeOps({ present = [] } = {}) {
  const existing = new Set(present)
  return {
    calls: [],
    async copy(from, to) {
      this.calls.push(['copy', from, to])
      existing.add(to)
    },
    async rename(from, to) {
      this.calls.push(['rename', from, to])
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

test('a plain drag MOVES, which is what Windows and Finder both do', async () => {
  const ops = fakeOps({ present: ['C:\\src\\take.mp4'] })
  const result = await dropFiles({ fileOperations: ops }, { paths: ['C:\\src\\take.mp4'], destination: 'C:\\dst' })

  assert.equal(result.ok, true)
  assert.equal(result.op, 'move')
  assert.deepEqual(ops.calls, [['rename', 'C:\\src\\take.mp4', 'C:\\dst\\take.mp4']])
})

test('Ctrl during the drop COPIES instead of moving', async () => {
  const ops = fakeOps({ present: ['C:\\src\\take.mp4'] })
  const result = await dropFiles(
    { fileOperations: ops },
    { op: 'copy', paths: ['C:\\src\\take.mp4'], destination: 'C:\\dst' }
  )

  assert.equal(result.op, 'copy')
  assert.deepEqual(ops.calls, [['copy', 'C:\\src\\take.mp4', 'C:\\dst\\take.mp4']])
})

test('a drop with no destination is refused, not silently ignored', async () => {
  const ops = fakeOps()
  const result = await dropFiles({ fileOperations: ops }, { paths: ['C:\\a\\b.txt'] })

  assert.equal(result.ok, false)
  assert.match(result.error, /destination/i)
  assert.deepEqual(ops.calls, [], 'nothing may be written when the destination is unknown')
})

test('an empty drop is refused rather than reported as done', async () => {
  const ops = fakeOps()
  const result = await dropFiles({ fileOperations: ops }, { paths: [], destination: 'C:\\dst' })

  assert.equal(result.ok, false)
  assert.match(result.error, /nothing/i)
})

test('dropping an item back into the folder it came from is a quiet no-op', async () => {
  const ops = fakeOps({ present: ['C:\\src\\take.mp4'] })
  const result = await dropFiles(
    { fileOperations: ops },
    { paths: ['C:\\src\\take.mp4'], destination: 'C:\\src' }
  )

  assert.equal(result.ok, true)
  assert.equal(result.noop, true)
  assert.equal(result.moved, 0)
  assert.deepEqual(ops.calls, [], 'a no-op must not touch the disk')
})

test('a folder cannot be dropped into its own subtree', async () => {
  const ops = fakeOps({ present: ['C:\\a\\sub'] })
  const result = await dropFiles(
    { fileOperations: ops },
    { paths: ['C:\\a'], destination: 'C:\\a\\sub' }
  )

  assert.equal(result.ok, false)
  assert.match(result.error, /into itself/i)
  assert.deepEqual(ops.calls, [], 'a self-drop must be refused before anything is written')
})

test('a folder cannot be dropped onto itself', async () => {
  const ops = fakeOps({ present: ['C:\\a'] })
  const result = await dropFiles({ fileOperations: ops }, { paths: ['C:\\a'], destination: 'C:\\a' })

  assert.equal(result.ok, false)
  assert.match(result.error, /into itself/i)
})

test('a drop onto an existing name is refused, never overwritten', async () => {
  const ops = fakeOps({ present: ['C:\\src\\take.mp4', 'C:\\dst\\take.mp4'] })
  const result = await dropFiles(
    { fileOperations: ops },
    { paths: ['C:\\src\\take.mp4'], destination: 'C:\\dst' }
  )

  assert.equal(result.ok, false)
  assert.match(result.error, /already an item named/i)
  assert.deepEqual(ops.calls, [], 'the file already there must survive untouched')
})

test('a partial failure is reported as a partial failure, naming the item that failed', async () => {
  const ops = fakeOps({ present: ['C:\\src\\a.txt', 'C:\\src\\b.txt'] })
  ops.rename = async function rename(from, to) {
    this.calls.push(['rename', from, to])
    if (from.endsWith('b.txt')) throw Object.assign(new Error('x'), { code: 'EBUSY' })
  }

  const result = await dropFiles(
    { fileOperations: ops },
    { paths: ['C:\\src\\a.txt', 'C:\\src\\b.txt'], destination: 'C:\\dst' }
  )

  assert.equal(result.ok, false)
  assert.equal(result.moved, 1)
  assert.match(result.error, /1 of 2 done/)
  assert.match(result.error, /b\.txt/)
})

test('names supplied by the caller are used in the message, not the path tail', async () => {
  const ops = fakeOps({ present: ['C:\\src\\x'] })
  const result = await dropFiles(
    { fileOperations: ops },
    { paths: ['C:\\src\\x'], names: { 'C:\\src\\x': 'A nicer name.mp4' }, destination: 'C:\\dst' }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(ops.calls, [['rename', 'C:\\src\\x', 'C:\\dst\\A nicer name.mp4']])
})

test('a Windows path with a forward slash still lands correctly', async () => {
  // Explorer and some drop sources hand over paths with mixed separators; the transfer
  // must normalize rather than create a folder named "src\x.mp4".
  const ops = fakeOps({ present: ['C:/src/take.mp4'] })
  const result = await dropFiles(
    { fileOperations: ops },
    { paths: ['C:/src/take.mp4'], destination: 'C:\\dst' }
  )

  assert.equal(result.ok, true)
  assert.equal(ops.calls[0][2], 'C:\\dst\\take.mp4')
})
