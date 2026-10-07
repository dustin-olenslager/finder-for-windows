'use strict'

/**
 * A mapped network drive must never be "recycled".
 *
 * The bug this file pins is the worst outcome the app can produce: Electron's
 * `shell.trashItem` does NOT fail on a mapped drive (Z: pointing at a share) — it deletes
 * the file permanently and reports success. The app then says "moved to the Recycle Bin",
 * which is a recoverable-sounding message about an unrecoverable delete.
 *
 * The path looks local, so the rule cannot be decided from the path alone; the drive list
 * has to say. These tests cover both halves: the pure comparison, and the use case that
 * refuses on it.
 */

const test = require('node:test')
const assert = require('node:assert')

const { isNetworkDrivePath } = require('../src/domain/paths')
const { performFileOperation } = require('../src/application/file-operations')

const NETWORK = ['Z:\\', 'Y:\\']

test('a file on a mapped drive is recognised', () => {
  assert.equal(isNetworkDrivePath('Z:\\Shared drives\\Show\\take.mp4', NETWORK), true)
})

test('a mapped drive root itself is recognised', () => {
  assert.equal(isNetworkDrivePath('Z:\\', NETWORK), true)
  assert.equal(isNetworkDrivePath('Z:', NETWORK), true)
})

test('a local drive is not mistaken for a mapped one', () => {
  assert.equal(isNetworkDrivePath('C:\\Users\\dustin\\take.mp4', NETWORK), false)
})

test('a drive whose LETTER merely starts the same is not a match', () => {
  // 'Z:\' must not be reported as containing 'ZZ:\' — the separator has to follow.
  assert.equal(isNetworkDrivePath('ZZ:\\x', ['Z:\\']), false)
})

test('the comparison is case-insensitive, as Windows is', () => {
  assert.equal(isNetworkDrivePath('z:\\share\\a.txt', ['Z:\\']), true)
})

test('no drive list means no claim either way', () => {
  assert.equal(isNetworkDrivePath('Z:\\share\\a.txt', []), false)
  assert.equal(isNetworkDrivePath('Z:\\share\\a.txt', undefined), false)
})

test('a forward-slash mapped path is still recognised', () => {
  assert.equal(isNetworkDrivePath('Z:/share/a.txt', ['Z:\\']), true)
})

/** An in-memory file layer that records what it was asked to do. */
function fakeOps() {
  return {
    trashed: [],
    async trash(target) {
      this.trashed.push(target)
    },
    async mkdir() {},
    async rename() {},
    async exists() {
      return false
    }
  }
}

test('trashing a file on a mapped drive is REFUSED, and nothing is deleted', async () => {
  const ops = fakeOps()
  const result = await performFileOperation(
    { fileOperations: ops, networkRoots: ['Z:\\'] },
    { op: 'trash', path: 'Z:\\Shared drives\\Show\\take.mp4' }
  )

  assert.equal(result.ok, false)
  assert.match(result.error, /mapped network drive/i)
  // The message must say the file survived — a refusal that reads like a failure would
  // make the user think it was deleted anyway.
  assert.match(result.error, /Nothing was deleted/i)
  assert.deepEqual(ops.trashed, [], 'a refusal must not touch the disk')
})

test('trashing a local file still works', async () => {
  const ops = fakeOps()
  const result = await performFileOperation(
    { fileOperations: ops, networkRoots: ['Z:\\'] },
    { op: 'trash', path: 'C:\\Users\\dustin\\take.mp4' }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(ops.trashed, ['C:\\Users\\dustin\\take.mp4'])
})

test('a UNC path is still refused by the older rule', async () => {
  const ops = fakeOps()
  const result = await performFileOperation(
    { fileOperations: ops, networkRoots: [] },
    { op: 'trash', path: '\\\\server\\share\\take.mp4' }
  )

  assert.equal(result.ok, false)
  assert.match(result.error, /Nothing was deleted/i)
  assert.deepEqual(ops.trashed, [])
})

test('a caller that cannot know the drives keeps the old behaviour', async () => {
  // Omitting networkRoots must not break anything: a mapped drive then slips through the
  // way it always did. This is the degradation path, and it is deliberate — a failed
  // drive lookup must not block a legitimate delete.
  const ops = fakeOps()
  const result = await performFileOperation(
    { fileOperations: ops },
    { op: 'trash', path: 'Z:\\Shared drives\\Show\\take.mp4' }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(ops.trashed, ['Z:\\Shared drives\\Show\\take.mp4'])
})

test('a drive root is still refused, mapped or not', async () => {
  const ops = fakeOps()
  const result = await performFileOperation(
    { fileOperations: ops, networkRoots: [] },
    { op: 'trash', path: 'C:\\' }
  )

  assert.equal(result.ok, false)
  assert.deepEqual(ops.trashed, [])
})
