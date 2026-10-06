'use strict'

/**
 * Tests for the ListDirectory use case — run with `node --test`.
 *
 * These prove the use case works with NO Electron, NO filesystem and NO vendor
 * module: an in-memory fake satisfies the DirectoryReader port. That is the point
 * of the port, and this file is the evidence it holds.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { listDirectory, describeReadFailure } = require('../src/application/list-directory')
const { assertDirectoryReader } = require('../src/application/ports/directory-reader')

/** An in-memory DirectoryReader. */
function fakeReader(items, { failWith } = {}) {
  return {
    // The port's signature takes the folder path; this fake ignores it on purpose, so the
    // underscore marks it as deliberately unused rather than accidentally so.
    async read(_dirPath) {
      if (failWith) {
        const error = new Error('fake failure')
        error.code = failWith
        throw error
      }
      return items
    }
  }
}

test('returns the items the reader supplies', async () => {
  const items = [{ name: 'a.txt', isDirectory: false, size: 12, mtime: 1, isHidden: false, isCloudPlaceholder: false }]
  const result = await listDirectory({ directoryReader: fakeReader(items) }, 'C:\\Users\\me')
  assert.equal(result.ok, true)
  assert.equal(result.path, 'C:\\Users\\me')
  assert.deepEqual(result.items, items)
})

test('rejects an empty or missing path without calling the reader', async () => {
  let called = false
  const reader = { async read() { called = true; return [] } }
  const result = await listDirectory({ directoryReader: reader }, '   ')
  assert.equal(result.ok, false)
  assert.equal(called, false)
  assert.match(result.error, /path is required/i)
})

test('turns ENOENT into a sentence a person can act on', async () => {
  const result = await listDirectory({ directoryReader: fakeReader([], { failWith: 'ENOENT' }) }, 'C:\\gone')
  assert.equal(result.ok, false)
  assert.match(result.error, /no longer exists/i)
  assert.match(result.error, /C:\\gone/)
})

test('distinguishes permission denied from an empty folder', async () => {
  const result = await listDirectory({ directoryReader: fakeReader([], { failWith: 'EACCES' }) }, 'C:\\locked')
  assert.equal(result.ok, false)
  assert.match(result.error, /permission/i)
})

test('an empty folder is a success with zero items, not an error', async () => {
  const result = await listDirectory({ directoryReader: fakeReader([]) }, 'C:\\empty')
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [])
})

test('every distinct failure meaning maps to its own human sentence', () => {
  // EACCES and EPERM are deliberately the SAME user-facing condition ("you do not
  // have permission"), so they are one meaning, not two. Every other code is its
  // own meaning and must read differently.
  const distinct = ['ENOENT', 'EACCES', 'ENOTDIR', 'EBUSY', 'UNKNOWN', 'EWHATEVER']
  const messages = distinct.map((code) => describeReadFailure({ code }, 'X'))
  assert.equal(new Set(messages).size, distinct.length, 'each meaning must read differently')
  for (const message of messages) assert.ok(message.length > 10, 'and be a sentence')

  // The two permission codes intentionally collapse to one message.
  assert.equal(
    describeReadFailure({ code: 'EPERM' }, 'X'),
    describeReadFailure({ code: 'EACCES' }, 'X')
  )
})

test('the port rejects an adapter that does not implement read', () => {
  assert.throws(() => assertDirectoryReader({}), /missing method: read/)
  assert.throws(() => assertDirectoryReader(null), /missing method: read/)
  assert.doesNotThrow(() => assertDirectoryReader({ read() {} }))
})
