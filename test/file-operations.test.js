'use strict'

/**
 * Tests for file operations and Windows name rules — `node --test`.
 *
 * An in-memory fake stands in for the disk, so every rule (no overwrite, no trashing
 * a drive root, reserved names) is pinned without touching a real filesystem.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validateName, suggestUniqueName } = require('../src/domain/file-name')
const { performFileOperation } = require('../src/application/file-operations')

// ---------------------------------------------------------------------------
// validateName — the Windows rules that bite
// ---------------------------------------------------------------------------

test('an ordinary name is accepted, with surrounding spaces trimmed', () => {
  assert.deepEqual(validateName('Report'), { ok: true, name: 'Report' })
  assert.deepEqual(validateName('  Report  '), { ok: true, name: 'Report' })
  assert.deepEqual(validateName('my file (1).txt'), { ok: true, name: 'my file (1).txt' })
})

test('the reserved characters are refused with a readable reason', () => {
  for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', 'a/b', 'a\\b', 'a|b', 'a?b', 'a*b']) {
    const result = validateName(bad)
    assert.equal(result.ok, false, `${bad} must be refused`)
    assert.match(result.error, /cannot contain/)
  }
})

test('a trailing dot is refused, but surrounding whitespace is simply trimmed', () => {
  // The silent-corruption case: "report." becomes "report" on disk, so the name the
  // user typed is not the name they get, and it can collide with an existing file.
  assert.equal(validateName('report.').ok, false)
  assert.match(validateName('report.').error, /end with a dot/)

  // A trailing space cannot survive the trim, so it is convenience, not an error.
  assert.deepEqual(validateName('report '), { ok: true, name: 'report' })
})

test('reserved device names are refused, including with an extension', () => {
  for (const bad of ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'LPT9', 'CON.txt', 'nul.log']) {
    assert.equal(validateName(bad).ok, false, `${bad} must be refused`)
  }
  // ...but a name merely starting with one is fine.
  assert.equal(validateName('console.log').ok, true)
  assert.equal(validateName('content.txt').ok, true)
})

test('empty, dot, dotdot and control characters are refused', () => {
  assert.equal(validateName('').ok, false)
  assert.equal(validateName('   ').ok, false)
  assert.equal(validateName('.').ok, false)
  assert.equal(validateName('..').ok, false)
  assert.equal(validateName('a\u0000b').ok, false)
  assert.equal(validateName('a\u001fb').ok, false)
})

test('a name over 255 characters is refused', () => {
  assert.equal(validateName('a'.repeat(256)).ok, false)
  assert.equal(validateName('a'.repeat(255)).ok, true)
})

test('a non-string is refused rather than coerced', () => {
  assert.equal(validateName(null).ok, false)
  assert.equal(validateName(42).ok, false)
})

test('suggestUniqueName avoids the names already present, case-insensitively', () => {
  assert.equal(suggestUniqueName('New Folder', []), 'New Folder')
  assert.equal(suggestUniqueName('New Folder', ['new folder']), 'New Folder 2')
  assert.equal(suggestUniqueName('New Folder', ['New Folder', 'New Folder 2']), 'New Folder 3')
})

// ---------------------------------------------------------------------------
// performFileOperation
// ---------------------------------------------------------------------------

/** An in-memory disk. `present` is the set of existing paths. */
function fakeOps({ present = [], fail = null } = {}) {
  const existing = new Set(present)
  return {
    calls: [],
    async mkdir(target) {
      this.calls.push(['mkdir', target])
      if (fail) throw Object.assign(new Error('x'), { code: fail })
      existing.add(target)
    },
    async rename(from, to) {
      this.calls.push(['rename', from, to])
      if (fail) throw Object.assign(new Error('x'), { code: fail })
      existing.delete(from)
      existing.add(to)
    },
    async trash(target) {
      this.calls.push(['trash', target])
      if (fail) throw Object.assign(new Error('x'), { code: fail })
      existing.delete(target)
    },
    async exists(target) {
      // Windows filesystems are case-INSENSITIVE, and the fake disk must be too, or it
      // cannot model the collisions this code exists to prevent. A case-sensitive fake
      // reports "free" for a name Windows would refuse.
      if (existing.has(target)) return true
      const lower = target.toLowerCase()
      return [...existing].some((p) => p.toLowerCase() === lower)
    }
  }
}

test('create-folder makes the folder and reports the new path', async () => {
  const ops = fakeOps({ present: ['C:\\Users\\me'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'create-folder', path: 'C:\\Users\\me', name: 'New Folder' }
  )
  assert.equal(result.ok, true)
  assert.equal(result.path, 'C:\\Users\\me\\New Folder')
  assert.deepEqual(ops.calls, [['mkdir', 'C:\\Users\\me\\New Folder']])
})

test('create-folder refuses a name that is already taken instead of merging', async () => {
  const ops = fakeOps({ present: ['C:\\Users\\me', 'C:\\Users\\me\\New Folder'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'create-folder', path: 'C:\\Users\\me', name: 'New Folder' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /already an item named/)
  assert.equal(ops.calls.length, 0, 'nothing may be written when the name is taken')
})

test('create-folder validates the name before touching the disk', async () => {
  const ops = fakeOps({ present: ['C:\\Users\\me'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'create-folder', path: 'C:\\Users\\me', name: 'bad:name' }
  )
  assert.equal(result.ok, false)
  assert.equal(ops.calls.length, 0)
})

test('create-folder refuses a bare drive path that did not normalize', async () => {
  const ops = fakeOps()
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'create-folder', path: 'not-a-path', name: 'X' }
  )
  assert.equal(result.ok, false)
  assert.equal(ops.calls.length, 0)
})

test('rename moves the item and reports where it went', async () => {
  const ops = fakeOps({ present: ['C:\\a\\old.txt'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'rename', path: 'C:\\a\\old.txt', name: 'new.txt' }
  )
  assert.equal(result.ok, true)
  assert.equal(result.path, 'C:\\a\\new.txt')
  assert.equal(result.from, 'C:\\a\\old.txt')
})

test('rename NEVER overwrites an existing item', async () => {
  const ops = fakeOps({ present: ['C:\\a\\old.txt', 'C:\\a\\taken.txt'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'rename', path: 'C:\\a\\old.txt', name: 'taken.txt' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /already an item named/)
  assert.equal(ops.calls.length, 0, 'a rename must not run when the target exists')
})

test('renaming to the same name is a no-op success, not an error', async () => {
  const ops = fakeOps({ present: ['C:\\a\\same.txt'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'rename', path: 'C:\\a\\same.txt', name: 'same.txt' }
  )
  assert.equal(result.ok, true)
  assert.equal(ops.calls.length, 0)
})

test('a case-only rename is performed, not refused as a collision', async () => {
  // Windows is case-insensitive, so readme.txt -> README.txt looks like the target
  // already exists. It is a real rename and must go through.
  const ops = fakeOps({ present: ['C:\\a\\readme.txt'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'rename', path: 'C:\\a\\readme.txt', name: 'README.txt' }
  )
  assert.equal(result.ok, true, `expected the rename to run, got ${result.error}`)
  assert.equal(ops.calls.length, 1)
  assert.deepEqual(ops.calls[0], ['rename', 'C:\\a\\readme.txt', 'C:\\a\\README.txt'])
})

test('renaming to a case-variant of a DIFFERENT file still refuses', async () => {
  // Only the same file's own name may be re-cased. Renaming notes.txt to Report.txt
  // while report.txt exists is a genuine collision on Windows, case notwithstanding.
  const ops = fakeOps({ present: ['C:\\a\\notes.txt', 'C:\\a\\report.txt'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'rename', path: 'C:\\a\\notes.txt', name: 'Report.txt' }
  )
  assert.equal(result.ok, false, 'a real collision must still be refused')
  assert.match(result.error, /already an item named/)
  assert.equal(ops.calls.length, 0)
})

test('trash uses the OS trash and never an unlink', async () => {
  const ops = fakeOps({ present: ['C:\\a\\junk.txt'] })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'trash', path: 'C:\\a\\junk.txt' }
  )
  assert.equal(result.ok, true)
  assert.deepEqual(ops.calls, [['trash', 'C:\\a\\junk.txt']])
})

test('trash refuses a drive root, which the Recycle Bin cannot hold', async () => {
  const ops = fakeOps()
  const result = await performFileOperation({ fileOperations: ops }, { op: 'trash', path: 'C:\\' })
  assert.equal(result.ok, false)
  assert.match(result.error, /drive/)
  assert.equal(ops.calls.length, 0)
})

test('an unknown operation is refused rather than guessed', async () => {
  const ops = fakeOps()
  const result = await performFileOperation({ fileOperations: ops }, { op: 'delete-everything' })
  assert.equal(result.ok, false)
  assert.match(result.error, /Unknown operation/)
})

test('a filesystem failure becomes a sentence, not an errno', async () => {
  const ops = fakeOps({ present: ['C:\\a\\x'], fail: 'EACCES' })
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'rename', path: 'C:\\a\\x', name: 'y' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /permission/)
  assert.ok(!result.error.includes('EACCES'), 'the raw code must not reach the user')
})
