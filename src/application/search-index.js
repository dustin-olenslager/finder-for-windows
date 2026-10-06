'use strict'

/**
 * Use case: SearchIndex — answer a query from the built index.
 *
 * Scoping is the whole design (FR-012):
 *   - scope 'folder' searches only what is inside the folder being viewed.
 *   - scope 'everywhere' searches the entire index.
 *
 * A query with an empty include list returns nothing rather than everything: an empty
 * search box must not dump a million rows at the user.
 *
 * Ranking puts a name hit above a content hit, then prefers shorter paths — a file
 * called "shot list.md" is a better answer than a log that mentions the phrase.
 */

const { parseQuery, matchesTokens } = require('../domain/search-query')

const MAX_RESULTS = 500

/**
 * @param {{ store: { read: Function } }} deps
 */
async function searchIndex(
  { store },
  { text, scope = 'everywhere', folder = null, limit = MAX_RESULTS }
) {
  const query = parseQuery(text)
  if (query.isEmpty) return { ok: true, results: [], total: 0, scanned: 0 }

  // Folder scope without a folder is a caller bug, and silently returning nothing
  // would look exactly like "no matches". Say which it is.
  if (scope === 'folder' && !normalizeFolder(folder)) {
    return { ok: false, error: 'A folder is required to search inside one.' }
  }

  const { records } = await store.read()
  if (records.length === 0) {
    return { ok: true, results: [], total: 0, scanned: 0, notIndexed: true }
  }

  const prefix = normalizeFolder(folder)
  const results = []
  let scanned = 0

  for (const record of records) {
    if (scope === 'folder') {
      if (!prefix) continue
      if (!record.path.toLowerCase().startsWith(prefix)) continue
    }
    scanned += 1

    const nameHit = matchesTokens(record.nameTokens ?? [], query)
    const contentHit = !nameHit && record.contentTokens ? matchesTokens(record.contentTokens, query) : false
    if (!nameHit && !contentHit) continue

    results.push({
      path: record.path,
      name: record.name,
      size: record.size,
      modifiedAt: record.modifiedAt,
      kind: record.kind,
      matched: nameHit ? 'name' : 'content'
    })
  }

  results.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched === 'name' ? -1 : 1
    if (a.path.length !== b.path.length) return a.path.length - b.path.length
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return {
    ok: true,
    results: results.slice(0, limit),
    total: results.length,
    scanned,
    query: { include: query.include, exclude: query.exclude }
  }
}

/**
 * A folder prefix that always ends in a separator, so "C:\App" cannot match "C:\Apple".
 *
 * The separator is taken from the path itself rather than assumed to be a backslash:
 * a forward-slash path would otherwise produce a prefix that matches nothing, and
 * folder-scoped search would silently return zero results.
 */
function normalizeFolder(folder) {
  if (typeof folder !== 'string' || folder === '') return null
  const trimmed = folder.replace(/[\\/]+$/, '')
  const separator = trimmed.includes('\\') ? '\\' : '/'
  return `${trimmed.toLowerCase()}${separator}`
}

module.exports = { searchIndex, normalizeFolder, MAX_RESULTS }
