'use strict'

/**
 * Windows file and folder name rules. Domain layer — pure, no I/O.
 *
 * WHY: Windows silently rejects some names and silently ACCEPTS others that then
 * cannot be deleted or are unreachable from Explorer (a trailing dot or space is
 * stripped by the OS, so "report." becomes "report" and the two can collide). The
 * app validates before it calls the filesystem, and explains what is wrong.
 */

// Reserved characters. The backslash is included because a name is a single segment.
const ILLEGAL = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

// Reserved device names, with or without an extension. Case-insensitive.
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

const MAX_LENGTH = 255

/**
 * Validate a proposed file or folder name.
 *
 * @param {string} name the proposed name (a single segment, not a path)
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
function validateName(name) {
  if (typeof name !== 'string') {
    return { ok: false, error: 'A name is required.' }
  }

  const trimmed = name.trim()
  if (trimmed === '') {
    return { ok: false, error: 'A name cannot be empty.' }
  }

  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: `A name cannot be longer than ${MAX_LENGTH} characters.` }
  }

  // "." and ".." are the current and parent directory, never a valid name.
  if (trimmed === '.' || trimmed === '..') {
    return { ok: false, error: '"." and ".." are not valid names.' }
  }

  for (const character of trimmed) {
    if (ILLEGAL.has(character)) {
      return { ok: false, error: `A name cannot contain any of  < > : " / \\ | ? *` }
    }
    // Control characters (0x00-0x1F) are rejected by the OS with an unhelpful error.
    if (character.codePointAt(0) < 0x20) {
      return { ok: false, error: 'A name cannot contain control characters.' }
    }
  }

  // A trailing DOT is silently removed by Windows, so the name asked for and the name
  // created differ — and "report." can then collide with an existing "report". Leading
  // and trailing WHITESPACE is simply trimmed above, so it cannot reach this point.
  if (trimmed.endsWith('.')) {
    return { ok: false, error: 'A name cannot end with a dot.' }
  }

  // Reserved device names apply to the stem, so "CON.txt" is also reserved.
  const stem = trimmed.split('.')[0].toUpperCase()
  if (RESERVED.has(stem)) {
    return { ok: false, error: `"${stem}" is a reserved Windows name.` }
  }

  return { ok: true, name: trimmed }
}

/** A name that is free, given the names already present. */
function suggestUniqueName(base, existingNames) {
  const taken = new Set(existingNames.map((n) => String(n).toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now()}`
}

module.exports = { validateName, suggestUniqueName, RESERVED, MAX_LENGTH }
