'use strict'

/**
 * Which folders the index walks, and which it refuses. Domain layer — pure.
 *
 * WHY THIS IS A DOMAIN RULE AND NOT A SETTING: indexing the wrong folder is not a
 * preference problem, it is a correctness one. Walking C:\Windows or a node_modules
 * tree makes the first scan take hours, and indexing another user's profile is a
 * privacy problem. These are rules with names, so they get a module and tests.
 */

/**
 * Folder names that are never indexed, wherever they appear.
 *
 * `node_modules` is here because the developer persona named it directly: a few
 * hundred thousand files of build output that nobody searches for by content.
 */
const NEVER_INDEX = new Set([
  'node_modules',
  '$recycle.bin',
  'system volume information',
  'windows',
  'winsxs',
  'recovery',
  'perflogs',
  '$windows.~bt',
  '$windows.~ws',
  'programdata\\microsoft\\windows defender',
  '.git',
  '.svn',
  '.hg'
])

/** Absolute prefixes that are never indexed on Windows. */
const NEVER_INDEX_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\$recycle.bin',
  'c:\\recovery',
  'c:\\perflogs'
]

/** The last path segment, lowercased, for a rule check. */
function baseName(path) {
  const trimmed = String(path).replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return (parts[parts.length - 1] || '').toLowerCase()
}

/**
 * Should this folder be skipped entirely?
 *
 * @param {string} dirPath absolute folder path
 * @param {Set<string>} [userExcludes] additional folders the user excluded
 */
function shouldSkipFolder(dirPath, userExcludes) {
  const lower = String(dirPath).toLowerCase().replace(/[\\/]+$/, '')
  const name = baseName(dirPath)

  if (NEVER_INDEX.has(name)) return true
  for (const prefix of NEVER_INDEX_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}\\`)) return true
  }
  if (userExcludes) {
    for (const excluded of userExcludes) {
      const target = String(excluded).toLowerCase().replace(/[\\/]+$/, '')
      if (lower === target || lower.startsWith(`${target}\\`)) return true
    }
  }
  return false
}

/** Should this FILE be indexed at all? Cheap rejects before anything is read. */
function shouldIndexFile(name, size, maxBytes) {
  if (typeof name !== 'string' || name === '') return false
  if (name.startsWith('~$')) return false // Office lock files
  if (/\.(tmp|temp|partial|crdownload|lock|swp)$/i.test(name)) return false
  // A huge file is not worth reading for content; its name is still indexed by the
  // caller, which is why this only guards the content pass.
  if (typeof size === 'number' && typeof maxBytes === 'number' && size > maxBytes) return false
  return true
}

module.exports = { shouldSkipFolder, shouldIndexFile, NEVER_INDEX, NEVER_INDEX_PREFIXES }
