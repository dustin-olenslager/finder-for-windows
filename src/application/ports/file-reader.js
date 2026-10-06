'use strict'

/**
 * Port: FileReader
 *
 * Declared here (use-case layer). Only what the preview pane needs.
 *
 * Contract:
 *   readHead(path, maxBytes) -> Promise<{ buffer: Buffer, truncated: boolean }>
 *
 *   - MUST read at most `maxBytes` bytes from disk. A preview must never pull a whole
 *     file into memory.
 *   - `truncated` is true when the file is larger than the requested window.
 *   - MUST NOT hydrate a cloud placeholder beyond the requested window (spec FR-027).
 */

const REQUIRED_METHODS = ['readHead']

function assertFileReader(candidate) {
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`FileReader adapter is missing method: ${method}`)
    }
  }
  return candidate
}

module.exports = { assertFileReader, REQUIRED_METHODS }
