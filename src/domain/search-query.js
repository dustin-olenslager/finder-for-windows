'use strict'

/**
 * Text tokenization and query parsing for search. Domain layer — pure, no I/O.
 *
 * WHY A TOKENIZER AT ALL: substring matching over a million paths is slow and gives
 * false hits ("cat" inside "concatenate"). Tokenizing both sides means "shot list"
 * finds "shot-list.md" and "SHOTLIST" but not "photoshoot", and it is what makes an
 * inverted index possible at all.
 *
 * The same rules MUST apply to indexing and to querying, or nothing matches — that is
 * the single easiest way to break a search feature.
 */

/** Words are runs of letters and digits. Everything else separates. */
const WORD = /[\p{L}\p{N}]+/gu

/**
 * Split text into lowercase tokens.
 *
 * Camel case and snake case are split as well, so "shotList" indexes as "shot" +
 * "list": a user searching "list" expects to find it.
 */
function tokenize(text) {
  if (typeof text !== 'string' || text === '') return []

  const tokens = []
  // First split camelCase / PascalCase boundaries, then take word runs.
  const separated = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')

  for (const match of separated.matchAll(WORD)) {
    const token = match[0].toLowerCase()
    if (token.length > 0) tokens.push(token)
  }
  return tokens
}

/**
 * Parse a query string into the terms to require, the terms to exclude, and any
 * quoted phrases.
 *
 * `"shot list" -draft` -> { include: ['shot list'], exclude: ['draft'] }
 * A bare phrase is kept as a phrase so the words must be adjacent.
 */
function parseQuery(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (raw === '') return { include: [], exclude: [], isEmpty: true }

  const include = []
  const exclude = []

  // Walk the string so quotes and a leading minus are honoured.
  const parts = raw.match(/-?"[^"]*"|\S+/g) ?? []

  for (const part of parts) {
    const negated = part.startsWith('-')
    const body = negated ? part.slice(1) : part
    const unquoted = body.startsWith('"') && body.endsWith('"') ? body.slice(1, -1) : body
    const tokens = tokenize(unquoted)
    if (tokens.length === 0) continue

    // A quoted phrase, or a bare multi-word run, must match adjacently.
    const phrase = tokens.length > 1 ? tokens.join(' ') : tokens[0]
    ;(negated ? exclude : include).push(phrase)
  }

  return { include, exclude, isEmpty: include.length === 0 && exclude.length === 0 }
}

/**
 * Does a token list satisfy a parsed query?
 *
 * @param {string[]} tokens the document's tokens, in order
 * @param {{include: string[], exclude: string[]}} query
 */
function matchesTokens(tokens, query) {
  const haystack = tokens.join(' ')

  for (const term of query.include) {
    // A phrase must appear contiguously; a single term is a whole-token match, which
    // is what stops "cat" matching "concatenate".
    const found = term.includes(' ') ? haystack.includes(term) : tokens.includes(term)
    if (!found) return false
  }

  for (const term of query.exclude) {
    const found = term.includes(' ') ? haystack.includes(term) : tokens.includes(term)
    if (found) return false
  }

  return true
}

/** Convenience: does this text satisfy the query? */
function matchesText(text, query) {
  if (query.isEmpty) return true
  return matchesTokens(tokenize(text), query)
}

module.exports = { tokenize, parseQuery, matchesTokens, matchesText }
