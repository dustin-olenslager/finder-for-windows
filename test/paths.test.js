'use strict'

/**
 * Tests for the Windows path rules — run with `node --test`.
 *
 * The "C:" cases are not hypothetical: shipping without them made the app list its
 * own install directory and lose every entry's metadata, because "C:" is
 * drive-RELATIVE on Windows, not the drive root.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizePath, parentOf, joinPath, isRoot, segments, isDriveBare } = require('../src/domain/paths')

test('a bare drive letter becomes the drive ROOT, never the drive-relative form', () => {
  assert.equal(normalizePath('C:'), 'C:\\')
  assert.equal(normalizePath('c:'), 'C:\\')
  assert.equal(normalizePath('D:'), 'D:\\')
  assert.equal(isDriveBare('C:'), true)
  assert.equal(isDriveBare('C:\\'), false)
})

test('joining onto a drive root stays rooted', () => {
  // The regression that produced the bug report: joining onto "C:" produced a
  // drive-relative path, which resolves against the process working directory.
  assert.equal(joinPath('C:', 'Windows'), 'C:\\Windows')
  assert.equal(joinPath('C:\\', 'Windows'), 'C:\\Windows')
  assert.equal(joinPath('C:\\Users', 'me'), 'C:\\Users\\me')
  assert.equal(joinPath('C:\\Users\\', 'me'), 'C:\\Users\\me')
  assert.equal(joinPath('/home/me', 'docs'), '/home/me/docs')
})

test('parentOf walks up to the drive root and then stops', () => {
  assert.equal(parentOf('C:\\Users\\me'), 'C:\\Users')
  assert.equal(parentOf('C:\\Users'), 'C:\\')
  // The old bug: this returned "C:", which is drive-relative.
  assert.notEqual(parentOf('C:\\Users'), 'C:')
  assert.equal(parentOf('C:\\'), null)
  assert.equal(parentOf('/home/me'), '/home')
  assert.equal(parentOf('/'), null)
})

test('parentOf handles UNC shares and their roots', () => {
  assert.equal(parentOf('\\\\server\\share\\folder\\file'), '\\\\server\\share\\folder')
  assert.equal(parentOf('\\\\server\\share\\folder'), '\\\\server\\share')
  assert.equal(parentOf('\\\\server\\share'), null)
})

test('trailing separators are stripped, roots keep exactly one', () => {
  assert.equal(normalizePath('C:\\Users\\me\\'), 'C:\\Users\\me')
  assert.equal(normalizePath('C:\\'), 'C:\\')
  assert.equal(normalizePath('/home/me/'), '/home/me')
  assert.equal(normalizePath('C:\\\\Users'), 'C:\\Users')
})

test('relative and empty input is refused rather than guessed', () => {
  for (const bad of ['', '   ', 'Users', 'me\\docs', null, undefined, 42]) {
    assert.equal(normalizePath(bad), null, `expected null for ${JSON.stringify(bad)}`)
  }
})

test('isRoot is true only for actual roots', () => {
  assert.equal(isRoot('C:\\'), true)
  assert.equal(isRoot('C:'), true)
  assert.equal(isRoot('C:\\Users'), false)
  assert.equal(isRoot('/'), true)
  assert.equal(isRoot('/home'), false)
  assert.equal(isRoot('\\\\server\\share'), true)
  assert.equal(isRoot('\\\\server\\share\\x'), false)
})

test('segments builds a breadcrumb, drive root first', () => {
  assert.deepEqual(segments('C:\\Users\\me'), ['C:\\', 'Users', 'me'])
  assert.deepEqual(segments('C:\\'), ['C:\\'])
  assert.deepEqual(segments('/home/me'), ['/', 'home', 'me'])
  assert.deepEqual(segments('\\\\server\\share\\a'), ['server', 'share', 'a'])
})
