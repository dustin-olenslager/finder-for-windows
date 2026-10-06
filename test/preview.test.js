'use strict'

/**
 * Tests for file classification and the preview use case — `node --test`.
 *
 * These are pure: an in-memory file reader stands in for the disk, so the preview
 * rules are pinned without touching a filesystem or Electron.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { kindOf, extensionOf, isPreviewable } = require('../src/domain/file-kind')
const { getPreview } = require('../src/application/get-preview')
const { readTextHead, decode } = require('../src/application/read-text-head')

// ---------------------------------------------------------------------------
// kindOf
// ---------------------------------------------------------------------------

test('kindOf classifies by extension, case-insensitively', () => {
  assert.equal(kindOf('photo.PNG'), 'image')
  assert.equal(kindOf('clip.mp4'), 'video')
  assert.equal(kindOf('song.flac'), 'audio')
  assert.equal(kindOf('report.pdf'), 'pdf')
  assert.equal(kindOf('sheet.xlsx'), 'spreadsheet')
  assert.equal(kindOf('deck.pptx'), 'presentation')
  assert.equal(kindOf('main.ts'), 'code')
  assert.equal(kindOf('notes.md'), 'text')
  assert.equal(kindOf('setup.exe'), 'executable')
})

test('a compound extension beats the simple one', () => {
  assert.equal(kindOf('backup.tar.gz'), 'archive')
  assert.equal(kindOf('archive.zip'), 'archive')
})

test('a dotfile has no extension and is not misread as one', () => {
  assert.equal(extensionOf('.gitignore'), '')
  assert.equal(kindOf('.gitignore'), 'other')
  assert.equal(extensionOf('trailing.'), '')
  assert.equal(kindOf('trailing.'), 'other')
  assert.equal(kindOf('no-extension'), 'other')
})

test('only renderable kinds claim to be previewable', () => {
  for (const kind of ['image', 'video', 'audio', 'pdf', 'text', 'code']) {
    assert.equal(isPreviewable(kind), true, `${kind} should be previewable`)
  }
  for (const kind of ['archive', 'executable', 'spreadsheet', 'other']) {
    assert.equal(isPreviewable(kind), false, `${kind} should not be previewable`)
  }
})

// ---------------------------------------------------------------------------
// readTextHead
// ---------------------------------------------------------------------------

const fakeReader = (content, { truncated = false } = {}) => ({
  readHead: async () => ({
    buffer: Buffer.from(content, 'utf8'),
    truncated
  })
})

test('readTextHead returns the decoded head of a text file', async () => {
  const result = await readTextHead({ fileReader: fakeReader('hello world') }, 'C:\\a\\b.txt')
  assert.equal(result.ok, true)
  assert.equal(result.text, 'hello world')
  assert.equal(result.encoding, 'utf-8')
})

test('a UTF-8 BOM is stripped rather than shown as a stray character', async () => {
  const result = await readTextHead({ fileReader: fakeReader('\uFEFFfirst line') }, 'x.txt')
  assert.equal(result.text, 'first line')
})

test('a NUL byte marks the content as binary and truncated', async () => {
  const result = await readTextHead({ fileReader: fakeReader('PK\u0000\u0000binary') }, 'x.txt')
  assert.equal(result.looksBinary, true)
  assert.equal(result.truncated, true, 'binary content must not be presented as complete text')
})

test('a file larger than the window reports itself truncated', async () => {
  const result = await readTextHead(
    { fileReader: fakeReader('abc', { truncated: true }) },
    'big.log'
  )
  assert.equal(result.truncated, true)
})

test('readTextHead refuses an empty path and explains a missing file', async () => {
  assert.equal((await readTextHead({ fileReader: fakeReader('') }, '')).ok, false)

  const missing = {
    readHead: async () => {
      const error = new Error('nope')
      error.code = 'ENOENT'
      throw error
    }
  }
  const result = await readTextHead({ fileReader: missing }, 'C:\\gone.txt')
  assert.equal(result.ok, false)
  assert.match(result.error, /no longer exists/)
})

test('decode strips replacement characters and reports them', () => {
  const decoded = decode(Buffer.from([0x68, 0x69, 0xff, 0xfe]))
  assert.equal(decoded.hadInvalidBytes, false, 'a lone invalid byte is not a NUL')
  assert.ok(!decoded.text.includes('\uFFFD'))
})

// ---------------------------------------------------------------------------
// getPreview
// ---------------------------------------------------------------------------

test('an image previews as an image, with no text read at all', async () => {
  let readCalls = 0
  const fileReader = {
    readHead: async () => {
      readCalls += 1
      return { buffer: Buffer.alloc(0), truncated: false }
    }
  }
  const result = await getPreview({ fileReader }, 'C:\\p\\cat.jpg', 'cat.jpg')
  assert.equal(result.mode, 'image')
  assert.equal(result.kind, 'image')
  assert.equal(readCalls, 0, 'an image must not be read into memory to preview it')
})

test('a text file previews with its content', async () => {
  const result = await getPreview({ fileReader: fakeReader('# Title') }, 'C:\\p\\n.md', 'n.md')
  assert.equal(result.mode, 'text')
  assert.equal(result.text, '# Title')
})

test('an unrenderable kind is handed to the system with a plain explanation', async () => {
  const result = await getPreview({ fileReader: fakeReader('') }, 'C:\\p\\a.zip', 'a.zip')
  assert.equal(result.mode, 'system')
  assert.match(result.note, /another app|No preview/)
})

test('a text file that cannot be read falls back to the system, not an error', async () => {
  const fileReader = {
    readHead: async () => {
      const error = new Error('denied')
      error.code = 'EACCES'
      throw error
    }
  }
  const result = await getPreview({ fileReader }, 'C:\\p\\secret.txt', 'secret.txt')
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'system')
  assert.match(result.note, /permission/)
})

test('getPreview refuses an empty path', async () => {
  const result = await getPreview({ fileReader: fakeReader('') }, '')
  assert.equal(result.ok, false)
})
