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

    /**
     * The names directly inside a folder. Used by "Keep both" to find a free name, which
     * must be free in the folder being WRITTEN TO rather than in the one being read from.
     * Names only (no stats), because that is all the caller needs and listing a large
     * folder should not pay for metadata it will never read.
     */
    async listNames(target) {
      const entries = await fs.readdir(target, { withFileTypes: true })
      return entries.map((entry) => entry.name)
    },

    async trash(target) {
      await trash(target)
    },

    /**
     * Copy a file OR a whole folder tree.
     *
     * `fs.cp` with `recursive` is the only supported route: it handles both cases and
     * follows the platform's own rules for links and permissions. `force: false` keeps
     * the never-clobber promise made by the use case — the destination check happens
     * there, and this refuses rather than silently replacing.
     */
    async copy(from, to) {
      await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
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
