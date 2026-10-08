'use strict'

/**
 * Port: FileIcons
 *
 * Declared here (use-case layer). Supplies the OS's own shell icon for a file type, so the
 * listing looks like the operating system rather than like a web page.
 *
 * Contract:
 *   forPath(path, isDirectory) -> Promise<string|null>
 *
 *   - MUST return a data URL for a rendered icon, or null when the OS has no answer. Null
 *     is a normal result, not a failure: the caller keeps its own vector glyph.
 *   - MUST be cheap for a folder of thousands of files. Implementations cache by file TYPE,
 *     because every `.mp4` shares one icon — a per-path lookup would put the shell round
 *     trip inside the listing loop and undo the bulk read.
 *   - MUST NOT read or hydrate file contents. A cloud placeholder's icon comes from its
 *     name and association, so resolving one must not trigger a download.
 */

const REQUIRED_METHODS = ['forPath']

function assertFileIcons(candidate) {
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`FileIcons adapter is missing method: ${method}`)
    }
  }
  return candidate
}

module.exports = { assertFileIcons, REQUIRED_METHODS }
