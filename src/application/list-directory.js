'use strict'

/**
 * Use case: ListDirectory
 *
 * One application operation: given a folder path, return what is in it.
 *
 * Layers: Use Cases / Application. Imports only the port's shape — no Electron,
 * no Node fs, no vendor module. It is testable with an in-memory fake reader.
 */

/**
 * @param {{ directoryReader: { read: (p: string) => Promise<object[]> } }} deps
 * @param {string} dirPath
 */
async function listDirectory({ directoryReader }, dirPath) {
  if (typeof dirPath !== 'string' || dirPath.trim() === '') {
    return { ok: false, error: 'A folder path is required.' }
  }

  try {
    const items = await directoryReader.read(dirPath)
    return { ok: true, path: dirPath, items }
  } catch (error) {
    return { ok: false, path: dirPath, error: describeReadFailure(error, dirPath) }
  }
}

/**
 * Turn a filesystem error into something a person can act on. The spec requires
 * an explanatory state rather than an empty list (FR-032).
 */
function describeReadFailure(error, dirPath) {
  const code = error?.code
  switch (code) {
    case 'ENOENT':
      return `That folder no longer exists: ${dirPath}`
    case 'EACCES':
    case 'EPERM':
      return `You do not have permission to open: ${dirPath}`
    case 'ENOTDIR':
      return `That is a file, not a folder: ${dirPath}`
    case 'EBUSY':
      return `That folder is in use by another program: ${dirPath}`
    case 'UNKNOWN':
      return `That location is unavailable: ${dirPath}`
    default:
      return `Could not open that folder (${code || 'unknown error'}): ${dirPath}`
  }
}

module.exports = { listDirectory, describeReadFailure }
