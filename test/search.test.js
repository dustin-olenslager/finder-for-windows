'use strict'

/**
 * Tests for search: tokenizing, query parsing, matching, scope, and ranking.
 *
 * These are pure — an in-memory store stands in for the index file, so every rule is
 * pinned without a filesystem or Electron.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { tokenize, parseQuery, matchesTokens } = require('../src/domain/search-query')
const { searchIndex, normalizeFolder } = require('../src/application/search-index')
const { shouldSkipFolder, shouldIndexFile } = require('../src/domain/index-rules')

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

test('tokenize lowercases and splits on punctuation', () => {
  assert.deepEqual(tokenize('Shot-List_v2.md'), ['shot', 'list', 'v2', 'md'])
  assert.deepEqual(tokenize('Hello, world!'), ['hello', 'world'])
  assert.deepEqual(tokenize(''), [])
  assert.deepEqual(tokenize(null), [])
})

test('tokenize splits camelCase so a word search finds it', () => {
  assert.deepEqual(tokenize('shotList'), ['shot', 'list'])
  assert.deepEqual(tokenize('HTTPServer'), ['http', 'server'])
})

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

test('an empty or blank query is flagged, not treated as "match everything"', () => {
  assert.equal(parseQuery('').isEmpty, true)
  assert.equal(parseQuery('   ').isEmpty, true)
})

test('a query splits into required terms', () => {
  const query = parseQuery('shot list')
  assert.deepEqual(query.include, ['shot', 'list'])
  assert.equal(query.isEmpty, false)
})

test('a leading minus excludes a term', () => {
  const query = parseQuery('shot -draft')
  assert.deepEqual(query.include, ['shot'])
  assert.deepEqual(query.exclude, ['draft'])
})

test('a quoted phrase is kept together', () => {
  const query = parseQuery('"shot list"')
  assert.deepEqual(query.include, ['shot list'])
})

// ---------------------------------------------------------------------------
// matchesTokens
// ---------------------------------------------------------------------------

test('a term matches a whole token, never a substring', () => {
  const query = parseQuery('cat')
  // "concatenate" must NOT match: this is the false-hit the tokenizer exists to stop.
  assert.equal(matchesTokens(tokenize('concatenate.md'), query), false)
  assert.equal(matchesTokens(tokenize('cat.png'), query), true)
})

test('every required term must be present', () => {
  const query = parseQuery('shot list')
  assert.equal(matchesTokens(tokenize('shot list.md'), query), true)
  assert.equal(matchesTokens(tokenize('shot.md'), query), false)
})

test('an excluded term vetoes a match', () => {
  const query = parseQuery('shot -draft')
  assert.equal(matchesTokens(tokenize('shot.md'), query), true)
  assert.equal(matchesTokens(tokenize('shot draft.md'), query), false)
})

test('a quoted phrase must appear adjacently', () => {
  const query = parseQuery('"shot list"')
  assert.equal(matchesTokens(tokenize('shot list final.md'), query), true)
  assert.equal(matchesTokens(tokenize('list of shots.md'), query), false)
})

// ---------------------------------------------------------------------------
// searchIndex
// ---------------------------------------------------------------------------

function fakeStore(records) {
  return { read: async () => ({ records, savedAt: Date.now() }) }
}

const RECORDS = [
  {
    path: 'C:\\Users\\d\\Videos\\shot-list-final.mp4',
    name: 'shot-list-final.mp4',
    nameTokens: tokenize('shot-list-final.mp4'),
    contentTokens: null,
    size: 1000,
    modifiedAt: 1,
    kind: 'video'
  },
  {
    path: 'C:\\Users\\d\\notes\\meeting.md',
    name: 'meeting.md',
    nameTokens: tokenize('meeting.md'),
    // The phrase only appears INSIDE this file, never in its name.
    contentTokens: tokenize('we reviewed the shot list and agreed'),
    size: 200,
    modifiedAt: 2,
    kind: 'text'
  },
  {
    path: 'C:\\Users\\d\\notes\\draft-notes.md',
    name: 'draft-notes.md',
    nameTokens: tokenize('draft-notes.md'),
    contentTokens: tokenize('shot list draft'),
    size: 300,
    modifiedAt: 3,
    kind: 'text'
  }
]

test('an empty query returns nothing rather than the whole index', async () => {
  const result = await searchIndex({ store: fakeStore(RECORDS) }, { text: '' })
  assert.deepEqual(result.results, [])
  assert.equal(result.total, 0)
})

test('everywhere is the default scope, so a bare query searches the whole index', async () => {
  const result = await searchIndex({ store: fakeStore(RECORDS) }, { text: 'agreed' })
  assert.equal(result.total, 1)
  assert.equal(result.results[0].name, 'meeting.md')
  assert.equal(result.results[0].matched, 'content')
})

test('folder scope with no folder is refused, not silently empty', async () => {
  const result = await searchIndex({ store: fakeStore(RECORDS) }, { text: 'shot', scope: 'folder' })
  assert.equal(result.ok, false)
  assert.match(result.error, /folder/i)
})

test('a name hit ranks above a content hit', async () => {
  const result = await searchIndex({ store: fakeStore(RECORDS) }, { text: 'shot' })
  assert.equal(result.results[0].name, 'shot-list-final.mp4')
  assert.equal(result.results[0].matched, 'name')
  assert.ok(result.results.some((r) => r.matched === 'content'), 'content hits still appear')
})

test('exclusion works across names and contents', async () => {
  const result = await searchIndex({ store: fakeStore(RECORDS) }, { text: 'shot -draft' })
  const names = result.results.map((r) => r.name)
  assert.ok(names.includes('shot-list-final.mp4'))
  assert.ok(!names.includes('draft-notes.md'), 'the excluded term must veto both kinds of hit')
})

test('folder scope only returns what is inside that folder', async () => {
  const result = await searchIndex(
    { store: fakeStore(RECORDS) },
    { text: 'shot', scope: 'folder', folder: 'C:\\Users\\d\\notes' }
  )
  assert.ok(result.results.length > 0)
  for (const item of result.results) {
    assert.ok(item.path.toLowerCase().startsWith('c:\\users\\d\\notes\\'), item.path)
  }
  assert.ok(!result.results.some((r) => r.name === 'shot-list-final.mp4'))
})

test('a folder prefix cannot leak into a sibling folder of the same name stem', async () => {
  // "C:\App" must not match "C:\Apple\..." — hence the trailing separator.
  assert.equal(normalizeFolder('C:\\App'), 'c:\\app\\')
  const result = await searchIndex(
    { store: fakeStore(RECORDS) },
    { text: 'shot', scope: 'folder', folder: 'C:\\Users\\d\\note' }
  )
  assert.equal(result.total, 0, 'a partial folder name must not match')
})

test('the folder separator is taken from the path, not assumed to be a backslash', () => {
  // Regression: hardcoding "\" made folder-scoped search return nothing on any path
  // that used forward slashes, and the failure looked exactly like "no matches".
  assert.equal(normalizeFolder('/home/d/notes'), '/home/d/notes/')
  assert.equal(normalizeFolder('/home/d/notes/'), '/home/d/notes/')
  assert.equal(normalizeFolder('C:\\Users\\d\\notes'), 'c:\\users\\d\\notes\\')
})

test('everywhere scope searches the whole index', async () => {
  const result = await searchIndex(
    { store: fakeStore(RECORDS) },
    { text: 'shot', scope: 'everywhere' }
  )
  assert.ok(result.results.length >= 2)
})

test('an index that has never been built says so instead of reporting no matches', async () => {
  const result = await searchIndex({ store: fakeStore([]) }, { text: 'shot' })
  assert.equal(result.notIndexed, true)
})

// ---------------------------------------------------------------------------
// index rules
// ---------------------------------------------------------------------------

test('build output and system folders are never indexed', () => {
  assert.equal(shouldSkipFolder('C:\\Users\\d\\app\\node_modules'), true)
  assert.equal(shouldSkipFolder('C:\\Windows\\System32'), true)
  assert.equal(shouldSkipFolder('C:\\Users\\d\\project\\.git'), true)
  assert.equal(shouldSkipFolder('C:\\$Recycle.Bin'), true)
  assert.equal(shouldSkipFolder('C:\\Users\\d\\Documents'), false)
})

test('a user exclusion skips that folder and everything under it', () => {
  const excludes = new Set(['C:\\Users\\d\\BigMedia'])
  assert.equal(shouldSkipFolder('C:\\Users\\d\\BigMedia', excludes), true)
  assert.equal(shouldSkipFolder('C:\\Users\\d\\BigMedia\\2026', excludes), true)
  assert.equal(shouldSkipFolder('C:\\Users\\d\\Other', excludes), false)
})

test('Office lock files, temp files and huge files are not read for content', () => {
  assert.equal(shouldIndexFile('~$budget.xlsx', 100, 1000), false)
  assert.equal(shouldIndexFile('download.crdownload', 100, 1000), false)
  assert.equal(shouldIndexFile('huge.log', 5000, 1000), false)
  assert.equal(shouldIndexFile('notes.md', 100, 1000), true)
})
