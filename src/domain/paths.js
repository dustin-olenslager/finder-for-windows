'use strict'

/**
 * Windows-aware path rules. Domain layer — pure string logic, no fs, no Electron.
 *
 * WHY THIS EXISTS
 * ---------------
 * On Windows, "C:" is NOT the root of the C: drive. It is the *current directory of
 * drive C*, so "C:" + "file.txt" resolves relative to wherever the process happens
 * to be — for a launched app, its own install folder. Joining a name onto "C:"
 * therefore silently reads the wrong directory, and every entry's metadata lookup
 * fails.
 *
 * Every path that leaves this module is either a fully rooted path ("C:\Users\me",
 * "\\server\share\dir", "/home/me") or null. Nothing drive-relative escapes.
 */

const SEPARATOR = /[\\/]/

/** A rooted Windows drive path: "C:\", "C:/", "c:\Users". */
const DRIVE_ROOTED = /^[A-Za-z]:[\\/]/
/** A bare drive reference: "C:" or "c:" — drive-relative, never a root. */
const DRIVE_BARE = /^[A-Za-z]:$/
/** A UNC share root: "\\server\share" (and deeper). */
const UNC = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/
/** A POSIX root. */
const POSIX_ROOTED = /^\//

function isDriveBare(value) {
  return DRIVE_BARE.test(value)
}

/**
 * Normalize a folder path into a fully rooted form.
 *
 * "C:"        -> "C:\\"        (the drive root, NOT the drive's current directory)
 * "C:\\Users" -> "C:\\Users"   (trailing separators stripped)
 * "C:\\"      -> "C:\\"        (a root keeps exactly one separator)
 * "/home/me/" -> "/home/me"
 * "\\\\srv\\share\\" -> "\\\\srv\\share"
 *
 * Returns null for anything that is not an absolute folder path.
 */
function normalizePath(value) {
  if (typeof value !== 'string') return null
  let p = value.trim()
  if (p === '') return null

  // A bare drive letter is the drive ROOT. This single line is the bug fix: without
  // it, "C:" stays drive-relative and every later join reads the wrong folder.
  if (isDriveBare(p)) return `${p[0].toUpperCase()}:\\`

  const isUnc = UNC.test(p)
  const isRooted = isUnc || DRIVE_ROOTED.test(p) || POSIX_ROOTED.test(p)
  if (!isRooted) return null

  // Collapse runs of separators (but keep a UNC's leading pair), then strip
  // trailing ones — except on a root, which must keep exactly one.
  const lead = isUnc ? p.slice(0, 2).replace(/\//g, '\\') : p.startsWith('/') ? '/' : p.slice(0, 3)
  let rest = p.slice(lead.length).replace(/[\\/]+/g, p.includes('\\') ? '\\' : '/')
  rest = rest.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')

  if (rest === '') return lead
  return lead.endsWith('\\') || lead.endsWith('/') ? lead + rest : `${lead}\\${rest}`
}

/** True when the path is a root (drive root, UNC share root, or POSIX root). */
function isRoot(value) {
  const p = normalizePath(value)
  if (p === null) return false
  if (DRIVE_ROOTED.test(p)) return p.length === 3
  if (POSIX_ROOTED.test(p)) return p === '/'
  if (UNC.test(p)) {
    const parts = p.replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean)
    return parts.length <= 2
  }
  return false
}

/**
 * The enclosing folder, or null when there is none (already at a root).
 *
 * "C:\\Users\\me" -> "C:\\Users"
 * "C:\\Users"     -> "C:\\"        <- the drive root, never "C:"
 * "C:\\"          -> null
 * "/home/me"      -> "/home"
 * "\\\\srv\\share\\a" -> "\\\\srv\\share"
 */
function parentOf(value) {
  const p = normalizePath(value)
  if (p === null || isRoot(p)) return null

  const sep = p.includes('\\') ? '\\' : '/'
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = trimmed.lastIndexOf(sep)

  if (idx < 0) return null
  // A drive root: "C:\Users" -> idx is 2 -> the parent is "C:\", not "C:".
  if (idx === 2 && DRIVE_ROOTED.test(trimmed)) return `${trimmed.slice(0, 2)}\\`
  if (idx === 0) return '/'
  return trimmed.slice(0, idx)
}

/** Join a child name onto a folder, always producing a rooted path. */
function joinPath(dirPath, name) {
  const base = normalizePath(dirPath)
  if (base === null) return null
  const sep = base.includes('\\') ? '\\' : '/'
  const clean = String(name).replace(/^[\\/]+/, '')
  if (clean === '') return base
  return base.endsWith(sep) ? base + clean : base + sep + clean
}

/** Split a rooted path into its segments, for a breadcrumb. */
function segments(value) {
  const p = normalizePath(value)
  if (p === null) return []
  const isUnc = UNC.test(p)
  const parts = p.replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean)
  if (isUnc) return parts.slice(0, 2).concat(parts.slice(2))
  if (DRIVE_ROOTED.test(p)) return [`${p.slice(0, 2)}\\`].concat(parts.slice(1))
  if (p === '/') return ['/']
  return ['/'].concat(parts)
}

module.exports = { normalizePath, parentOf, joinPath, isRoot, segments, isDriveBare }
