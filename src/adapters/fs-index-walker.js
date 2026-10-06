'use strict'

/**
 * Adapter: FsIndexWalker — the index's view of the filesystem.
 *
 * Layers: Interface Adapters. Deliberately separate from FsDirectoryReader: the index
 * wants a plain, non-throwing listing it can walk at speed, while the browser wants the
 * rich item shape with cloud-placeholder and attribute detail.
 *
 * `readHead` is bounded on purpose. Reading a whole file to index its contents would
 * hydrate a cloud placeholder and pull gigabytes off disk for a search nobody asked
 * for; a window is enough to find the words a person remembers.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { kindOf } = require('../domain/file-kind')

function createFsIndexWalker() {
  return {
    join: (dir, name) => path.join(dir, name),

    async readdir(dirPath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const out = []

      for (const entry of entries) {
        const full = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          out.push({ name: entry.name, isDirectory: true })
          continue
        }
        if (!entry.isFile()) continue // skip sockets, devices and symlinks

        let size = null
        let modifiedAt = null
        try {
          const stat = await fs.stat(full)
          size = stat.size
          modifiedAt = stat.mtimeMs
        } catch {
          // Vanished or unreadable: still worth listing by name.
        }

        out.push({
          name: entry.name,
          isDirectory: false,
          size,
          modifiedAt,
          kind: kindOf(entry.name)
        })
      }

      return out
    },

    /** At most `maxBytes` of decoded text, or null when there is nothing readable. */
    async readHead(filePath, maxBytes) {
      const handle = await fs.open(filePath, 'r')
      try {
        const stat = await handle.stat()
        const wanted = Math.max(0, Math.min(maxBytes, stat.size))
        if (wanted === 0) return null

        const buffer = Buffer.alloc(wanted)
        const { bytesRead } = await handle.read(buffer, 0, wanted, 0)
        const slice = bytesRead === wanted ? buffer : buffer.subarray(0, bytesRead)

        // A NUL byte in the first block means binary; do not index its bytes as text.
        const sample = slice.subarray(0, 8192)
        for (const byte of sample) if (byte === 0) return null

        return slice.toString('utf8')
      } finally {
        await handle.close()
      }
    }
  }
}

module.exports = { createFsIndexWalker }
