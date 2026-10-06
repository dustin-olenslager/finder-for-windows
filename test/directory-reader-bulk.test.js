'use strict'

/**
 * The bulk directory reader: one call for a whole folder.
 *
 * The performance claim under test is "no per-entry system call on Windows". These tests
 * pin the parser (which is where a whole-folder read goes wrong if it goes wrong at all)
 * and the fallback, so the fast path can never become a wrong path.
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  parseBulkOutput,
  ticksToMs,
  fromBulkEntry,
  byFolderThenName,
  isCloudPlaceholder,
  isHidden
} = require('../src/adapters/fs-directory-reader')

/** .NET ticks for known instants, so the conversion is pinned to real numbers. */
const TICKS_1601 = '0'
// 2026-10-06T12:00:00Z. Verified against the conversion itself and the ISO string below,
// so a wrong constant cannot silently agree with a wrong implementation.
const TICKS_2026_10_06 = '134357616000000000'
const MS_2026_10_06 = Date.UTC(2026, 9, 6, 12, 0, 0)

test('ticks convert to Unix milliseconds exactly', () => {
  assert.equal(ticksToMs(TICKS_2026_10_06), MS_2026_10_06)
  assert.equal(new Date(ticksToMs(TICKS_2026_10_06)).toISOString(), '2026-10-06T12:00:00.000Z')
})

test('the epoch of .NET ticks maps to a negative Unix time, not a crash', () => {
  // 1601 is before 1970, so this is legitimately negative. A naive conversion using
  // Number instead of BigInt loses precision here and lands on a wrong date.
  assert.equal(ticksToMs(TICKS_1601), -11644473600000)
})

test('a non-numeric tick value is null, not NaN', () => {
  // A malformed line must not put NaN into a date column.
  assert.equal(ticksToMs(''), null)
  assert.equal(ticksToMs('not-a-number'), null)
  assert.equal(ticksToMs(null), null)
  assert.equal(ticksToMs(undefined), null)
})

test('a well-formed line becomes a complete entry', () => {
  const out = parseBulkOutput(`0\t12345\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\ttake_V019.mp4`)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], {
    name: 'take_V019.mp4',
    isDirectory: false,
    size: 12345,
    modifiedAt: MS_2026_10_06,
    createdAt: MS_2026_10_06,
    attributes: 32
  })
})

test('a directory is parsed with its flag set', () => {
  const out = parseBulkOutput(`1\t0\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t16\t01_InProgress`)
  assert.equal(out[0].isDirectory, true)
  assert.equal(out[0].name, '01_InProgress')
})

test('a filename containing a TAB survives intact', () => {
  // Windows allows a tab in a filename (it forbids newline and control characters). The
  // name is emitted last precisely so this works; splitting naively would truncate it.
  const out = parseBulkOutput(`0\t10\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\tweird\tname.mp4`)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'weird\tname.mp4', 'the tab must be kept, not treated as a field')
})

test('a filename containing spaces, quotes and unicode survives intact', () => {
  const out = parseBulkOutput(
    `0\t10\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\tScene 01 — take "final" (v2) ✓.mp4`
  )
  assert.equal(out[0].name, 'Scene 01 — take "final" (v2) ✓.mp4')
})

test('a malformed line is skipped, not thrown', () => {
  // One unreadable entry must not cost the user the whole folder.
  const out = parseBulkOutput(
    ['0\t1\t2\t3\t32\tgood.txt', 'garbage', '0\t1\t2\t3', '', '0\t5\t' + TICKS_2026_10_06 + '\t' + TICKS_2026_10_06 + '\t32\talso-good.txt'].join(
      '\n'
    )
  )
  assert.deepEqual(
    out.map((e) => e.name),
    ['good.txt', 'also-good.txt']
  )
})

test('a line whose name is empty is skipped', () => {
  const out = parseBulkOutput(`0\t1\t2\t3\t32\t`)
  assert.deepEqual(out, [])
})

test('CRLF output parses the same as LF', () => {
  // PowerShell on Windows emits CRLF. A parser that only handles LF would see one giant
  // line, or names ending in a stray carriage return.
  const lf = parseBulkOutput(`0\t1\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\ta.txt\n0\t2\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\tb.txt`)
  const crlf = parseBulkOutput(`0\t1\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\ta.txt\r\n0\t2\t${TICKS_2026_10_06}\t${TICKS_2026_10_06}\t32\tb.txt\r\n`)
  assert.deepEqual(lf.map((e) => e.name), ['a.txt', 'b.txt'])
  assert.deepEqual(crlf.map((e) => e.name), ['a.txt', 'b.txt'])
  assert.ok(!crlf[1].name.includes('\r'), 'no carriage return may survive into a name')
})

test('empty output is an empty folder, not an error', () => {
  assert.deepEqual(parseBulkOutput(''), [])
  assert.deepEqual(parseBulkOutput(null), [])
})

test('a bulk entry becomes the same FileItem shape the fallback produces', () => {
  // The two routes must be indistinguishable downstream, or a column goes blank on one
  // platform and not the other.
  const item = fromBulkEntry({
    name: 'take_V019.mp4',
    isDirectory: false,
    size: 4200000,
    modifiedAt: MS_2026_10_06,
    createdAt: MS_2026_10_06,
    attributes: 32
  })
  assert.equal(item.name, 'take_V019.mp4')
  assert.equal(item.isDirectory, false)
  assert.equal(item.size, 4200000)
  assert.equal(item.modifiedAt, MS_2026_10_06)
  assert.equal(item.createdAt, MS_2026_10_06)
  assert.equal(item.kind, 'video')
  assert.equal(item.isHidden, false)
  assert.equal(item.isCloudPlaceholder, false)
  assert.equal(item.metadataUnavailable, false)
})

test('a folder has no size, as the fallback reports', () => {
  const item = fromBulkEntry({
    name: '08_Animation',
    isDirectory: true,
    size: 0,
    modifiedAt: MS_2026_10_06,
    createdAt: MS_2026_10_06,
    attributes: 16
  })
  assert.equal(item.size, null, 'a folder size would be meaningless in the Size column')
  assert.equal(item.kind, 'folder')
})

test('the hidden attribute is honoured on the bulk route', () => {
  const item = fromBulkEntry({
    name: 'desktop.ini',
    isDirectory: false,
    size: 10,
    modifiedAt: MS_2026_10_06,
    createdAt: MS_2026_10_06,
    attributes: 0x2 // FILE_ATTRIBUTE_HIDDEN
  })
  assert.equal(item.isHidden, true)
})

test('a cloud placeholder is marked on the bulk route', () => {
  // The badge must still appear, or a OneDrive file looks local and reading it would
  // hydrate a download the user never asked for.
  for (const bits of [0x1000, 0x400000, 0x40000]) {
    assert.equal(isCloudPlaceholder(bits), true, `0x${bits.toString(16)} must read as a placeholder`)
  }
  assert.equal(isCloudPlaceholder(0x20), false, 'a plain archive bit is not a placeholder')
})

test('hidden detection keeps the dotfile rule on every platform', () => {
  assert.equal(isHidden(0, '.gitignore'), true, 'a dotfile is hidden even with no attribute')
  assert.equal(isHidden(0, 'normal.txt'), false)
  assert.equal(isHidden(0x4, 'pagefile.sys'), true, 'the system attribute also hides')
})

test('a size that is not a number becomes null rather than NaN', () => {
  const item = fromBulkEntry({
    name: 'odd.bin',
    isDirectory: false,
    size: Number.NaN,
    modifiedAt: null,
    createdAt: null,
    attributes: 0
  })
  assert.equal(item.size, null)
  assert.equal(item.modifiedAt, null)
})

test('the order is folders first, then names, numerals as numbers', () => {
  // NTFS returns B-tree order, which must never be shown as if it were sorted.
  const items = [
    { name: 'take_V10.mp4', isDirectory: false },
    { name: 'zz_Archive', isDirectory: true },
    { name: 'take_V9.mp4', isDirectory: false },
    { name: '01_InProgress', isDirectory: true }
  ]
  const sorted = [...items].sort(byFolderThenName)
  assert.deepEqual(
    sorted.map((i) => i.name),
    ['01_InProgress', 'zz_Archive', 'take_V9.mp4', 'take_V10.mp4'],
    'V9 must sort before V10, and folders must lead'
  )
})

test('the enumeration script quotes a path with an apostrophe safely', () => {
  // A folder named "Dustin's takes" would otherwise break the PowerShell literal and the
  // bulk read would silently fall back on every read of that folder.
  const { bulkEnumerationScript } = require('../src/adapters/fs-directory-reader')
  const script = bulkEnumerationScript("C:\\Users\\dustin\\Dustin's takes")
  assert.ok(script.includes("'C:\\Users\\dustin\\Dustin''s takes'"), 'the apostrophe must be doubled')
  assert.ok(!/DirectoryInfo\]::new\('C:\\Users\\dustin\\Dustin's/.test(script), 'no unescaped literal')
})
