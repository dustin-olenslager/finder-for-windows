'use strict'

/**
 * Port: Drives
 *
 * The sidebar's Locations section. Declared here; the adapter probes the platform.
 *
 * Contract:
 *   list() -> Promise<Array<{ path: string, label: string, isRemovable: boolean }>>
 *
 *   - `path` is always a ROOTED path ("C:\\"), never drive-relative (see
 *     src/domain/paths.js — "C:" is not the root of C: on Windows).
 *   - MUST NOT throw; an unreadable drive is simply absent.
 */

const REQUIRED_METHODS = ['list']

function assertDrives(candidate) {
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`Drives adapter is missing method: ${method}`)
    }
  }
  return candidate
}

module.exports = { assertDrives, REQUIRED_METHODS }
