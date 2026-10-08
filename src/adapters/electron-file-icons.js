'use strict'

/**
 * Adapter: FileIcons (port: file-icons)
 *
 * The OS knows what every file type looks like — its shell icon, the same one Explorer
 * draws. Using it is the difference between an app that shows you your files and one that
 * shows a grid of identical page glyphs.
 *
 * Two rules make this affordable:
 *
 * 1. Cache by EXTENSION, not by path. A folder of 5,000 videos needs ONE shell lookup, not
 *    5,000: every .mp4 has the same icon. This is why the cache key is the extension and
 *    the sample path is only the thing the OS needs to resolve the association.
 * 2. Never block a listing on it. `app.getFileIcon` is an async round-trip to the shell, so
 *    the renderer draws its own vector glyph first and swaps in the real icon when it
 *    arrives. A folder renders at full speed whether or not the shell answers.
 *
 * A cloud placeholder is fine here: the icon comes from the file's NAME and its
 * association, so nothing is hydrated and nothing is downloaded. (Thumbnails would be a
 * different matter — those need the bytes, and would pull a placeholder down.)
 *
 * `app.getFileIcon` returns its own nativeImage, so nothing here needs `nativeImage` to
 * build one.
 */

const path = require('node:path')

/** The key for a folder, and for a file with no extension at all. */
const FOLDER_KEY = '#folder'
const NO_EXTENSION_KEY = '#none'

function createFileIconProvider({ app }) {
  /** extension (or folder) -> data URL. The whole point: one entry per FILE TYPE. */
  const cache = new Map()
  /** In-flight lookups, so ten rows of the same type make one call between them. */
  const pending = new Map()

  async function resolve(key, samplePath) {
    if (cache.has(key)) return cache.get(key)
    // Share one call between every row of the same type.
    if (pending.has(key)) return pending.get(key)

    const work = (async () => {
      try {
        const image = await app.getFileIcon(samplePath, { size: 'normal' })
        if (!image || image.isEmpty()) return null
        const url = image.toDataURL()
        cache.set(key, url)
        return url
      } catch {
        // The shell refusing an icon is not an error the user needs to hear about. The
        // renderer keeps its own vector glyph, which is a perfectly good answer.
        return null
      } finally {
        pending.delete(key)
      }
    })()

    pending.set(key, work)
    return work
  }

  return {
    /**
     * @param {string} target an absolute path to a real file or folder
     * @param {boolean} isDirectory
     * @returns {Promise<string|null>} a data URL, or null to keep the built-in glyph
     */
    async forPath(target, isDirectory) {
      if (typeof target !== 'string' || target.trim() === '') return null
      if (isDirectory) return resolve(FOLDER_KEY, target)
      const extension = path.extname(target).toLowerCase()
      return resolve(extension || NO_EXTENSION_KEY, target)
    },

    /** How many distinct file types have been resolved. Used by the tests. */
    size: () => cache.size
  }
}

module.exports = { createFileIconProvider, FOLDER_KEY, NO_EXTENSION_KEY }
