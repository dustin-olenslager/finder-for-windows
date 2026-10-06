'use strict'

/**
 * Adapter: JsonIndexStore — persists the search index and the app's own data.
 *
 * Layers: Interface Adapters. The only place that knows where the app's data lives.
 *
 * WHY NOT SQLITE: the app ships no native modules today (they would need a
 * win32-arm64 prebuild), and the index is a derived artifact — it can be rebuilt from
 * the disk at any time. A JSON store is the smallest thing that works, is trivially
 * inspectable when something is wrong, and keeps the packaging simple. Tags and saved
 * searches ride in the same file because they are the same size of problem.
 *
 * Records are appended as newline-delimited JSON while scanning and compacted on
 * write: appending a million records one at a time through a JSON array is not viable.
 */

const fs = require('node:fs/promises')
const path = require('node:path')

function createJsonIndexStore({ dataDir }) {
  const file = path.join(dataDir, 'index.json')
  const stateFile = path.join(dataDir, 'state.json')

  // The search box fires on every keystroke, so re-reading and JSON-parsing the whole
  // index each time is the single biggest avoidable cost in the app. Hold the parsed
  // records and only re-parse when the file itself has changed (mtime + size).
  let cache = null
  let cacheKey = null

  return {
    file,
    stateFile,

    async read() {
      try {
        const stat = await fs.stat(file)
        const key = `${stat.mtimeMs}:${stat.size}`
        if (cache && cacheKey === key) return cache

        const raw = await fs.readFile(file, 'utf8')
        if (raw.trim() === '') {
          cache = { records: [], savedAt: null }
          cacheKey = key
          return cache
        }
        const parsed = JSON.parse(raw)
        cache = {
          records: Array.isArray(parsed.records) ? parsed.records : [],
          savedAt: parsed.savedAt ?? null,
          stats: parsed.stats ?? null
        }
        cacheKey = key
        return cache
      } catch {
        // A missing or unreadable index is not an error: it is rebuilt from the disk.
        cache = null
        cacheKey = null
        return { records: [], savedAt: null }
      }
    },

    async write(records, stats) {
      await fs.mkdir(dataDir, { recursive: true })
      // Write to a temporary file and rename: a scan interrupted mid-write must never
      // leave a truncated index behind.
      const temp = `${file}.tmp`
      const payload = JSON.stringify({ savedAt: Date.now(), stats, records })
      await fs.writeFile(temp, payload, 'utf8')
      await fs.rename(temp, file)
      // The write invalidates the cache; drop it so the next read re-parses.
      cache = null
      cacheKey = null
      return { savedAt: Date.now(), count: records.length }
    },

    /** App-state that is NOT derived: tags, saved searches, exclusions, preferences. */
    async readState() {
      try {
        const raw = await fs.readFile(stateFile, 'utf8')
        return JSON.parse(raw)
      } catch {
        return { tags: {}, savedSearches: [], exclusions: [], indexingPaused: false }
      }
    },

    async writeState(state) {
      await fs.mkdir(dataDir, { recursive: true })
      const temp = `${stateFile}.tmp`
      await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
      await fs.rename(temp, stateFile)
      return state
    }
  }
}

module.exports = { createJsonIndexStore }
