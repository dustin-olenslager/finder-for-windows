'use strict'

/**
 * Port: KnownFolders
 *
 * The sidebar's Favorites. Declared here (use-case layer); the adapter decides how
 * the platform reports them.
 *
 * Contract:
 *   list() -> Promise<Array<{ id: string, label: string, path: string|null }>>
 *
 *   - `path` is null when the folder does not exist on this machine. The sidebar
 *     hides those rather than offering a dead row.
 *   - MUST NOT throw: a platform that cannot report its folders returns [].
 */

const REQUIRED_METHODS = ['list']

function assertKnownFolders(candidate) {
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`KnownFolders adapter is missing method: ${method}`)
    }
  }
  return candidate
}

module.exports = { assertKnownFolders, REQUIRED_METHODS }
