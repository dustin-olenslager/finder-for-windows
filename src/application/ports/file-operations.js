'use strict'

/**
 * Port: FileOperations
 *
 * The mutating half of the filesystem, declared in the use-case layer.
 *
 * Contract:
 *   mkdir(path)            -> Promise<void>            fails if it already exists
 *   rename(from, to)       -> Promise<void>
 *   trash(path)            -> Promise<void>            moves to the OS trash, not delete
 *   exists(path)           -> Promise<boolean>
 *
 *   - `trash` MUST use the platform trash (the Windows Recycle Bin), never an
 *     unlink: the spec requires every deletion be recoverable outside this app
 *     (D-0007).
 *   - None of these may swallow an error: the use case turns a failure code into a
 *     sentence for the user.
 */

const REQUIRED_METHODS = ['mkdir', 'rename', 'trash', 'exists']

function assertFileOperations(candidate) {
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate?.[method] !== 'function') {
      throw new TypeError(`FileOperations adapter is missing method: ${method}`)
    }
  }
  return candidate
}

module.exports = { assertFileOperations, REQUIRED_METHODS }
