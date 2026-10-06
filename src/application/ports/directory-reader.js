'use strict'

/**
 * Port: DirectoryReader
 *
 * Declared in the use-case layer. The application knows only this shape; it never
 * knows whether the bytes come from Node's fs, a native enumeration module, or a
 * test double.
 *
 * Contract:
 *   read(dirPath: string) -> Promise<FileItem[]>
 *
 *   Each FileItem is a plain domain value:
 *     { name: string, isDirectory: boolean, size: number|null, mtime: number|null,
 *       isHidden: boolean, isCloudPlaceholder: boolean }
 *
 *   - MUST reject (not return an empty list) when the directory cannot be read,
 *     so the caller can tell "empty folder" from "permission denied".
 *   - MUST NOT read file contents — enumeration only, so a cloud placeholder is
 *     never hydrated (spec FR-027).
 *   - MUST return entries in a deterministic order (the caller may re-sort).
 *
 * This module is documentation plus a shape check; JavaScript has no interfaces.
 * An adapter satisfies it structurally.
 */

const REQUIRED_METHODS = ['read']

/**
 * Assert that a candidate satisfies the port. Used at the composition root so a
 * wiring mistake fails loudly at startup instead of at the first click.
 */
function assertDirectoryReader(candidate) {
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`DirectoryReader adapter is missing method: ${method}`)
    }
  }
  return candidate
}

module.exports = { assertDirectoryReader, REQUIRED_METHODS }
