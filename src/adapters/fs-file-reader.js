'use strict'

/**
 * Adapter: FsFileReader — implements the FileReader port with Node's fs.
 *
 * Layers: Interface Adapters. The only place that knows how to read bytes.
 *
 * Reads a bounded window with a single `open`/`read`/`close` rather than reading the
 * whole file and slicing: on a 4 GB log the difference is the app opening instantly
 * versus the app appearing to hang, and on a OneDrive placeholder it is the
 * difference between hydrating one block and hydrating the entire file (spec FR-027).
 */

const fs = require('node:fs/promises')

function createFsFileReader() {
  return {
    async readHead(filePath, maxBytes) {
      const handle = await fs.open(filePath, 'r')
      try {
        const stat = await handle.stat()
        if (stat.isDirectory()) {
          const error = new Error('EISDIR: illegal operation on a directory')
          error.code = 'EISDIR'
          throw error
        }

        const wanted = Math.max(0, Math.min(maxBytes, stat.size))
        const buffer = Buffer.alloc(wanted)
        if (wanted === 0) return { buffer, truncated: false }

        const { bytesRead } = await handle.read(buffer, 0, wanted, 0)
        return {
          buffer: bytesRead === wanted ? buffer : buffer.subarray(0, bytesRead),
          truncated: stat.size > wanted
        }
      } finally {
        await handle.close()
      }
    }
  }
}

module.exports = { createFsFileReader }
