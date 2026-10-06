'use strict'

/**
 * Adapter: FsFileOperations — implements the FileOperations port.
 *
 * Layers: Interface Adapters. The only place that knows how to mutate the disk.
 *
 * `trash` is INJECTED rather than implemented here: moving a file to the Windows
 * Recycle Bin is not exposed by Node, so the composition root passes in Electron's
 * `shell.trashItem`. That keeps this file free of Electron and testable, while the
 * one platform-specific call lives where platform calls belong.
 */

const fs = require('node:fs/promises')

/**
 * @param {{ trash: (p: string) => Promise<void> }} deps
 */
function createFsFileOperations({ trash }) {
  if (typeof trash !== 'function') {
    throw new TypeError('createFsFileOperations requires a trash function')
  }

  return {
    async mkdir(target) {
      // Not `recursive: true`: creating a folder that already exists is an error the
      // user should see, not something to paper over.
      await fs.mkdir(target)
    },

    async rename(from, to) {
      await fs.rename(from, to)
    },

    async trash(target) {
      await trash(target)
    },

    async exists(target) {
      try {
        await fs.stat(target)
        return true
      } catch {
        return false
      }
    }
  }
}

module.exports = { createFsFileOperations }
