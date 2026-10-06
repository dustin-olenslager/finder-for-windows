'use strict'

/**
 * Use case: BuildIndex — walk the drives and record what is there.
 *
 * Two passes over each folder, in this order:
 *
 *   1. METADATA for everything (name, path, size, dates, kind). This is what makes
 *      search useful the moment the scan starts, and it is cheap: one stat per entry.
 *   2. CONTENT for the files worth reading, bounded per file. A first scan that waited
 *      for every file's contents would leave search dead for an hour.
 *
 * The scan reports progress as it goes and is cancellable between folders, so the UI
 * can show what is covered and stop on request (FR-030, FR-031).
 *
 * Ports used: IndexWalker (readdir/stat/readHead), supplied by the composition root.
 */

const { tokenize } = require('../domain/search-query')
const { shouldSkipFolder, shouldIndexFile } = require('../domain/index-rules')

/** Only these kinds have their contents read during a scan. */
const CONTENT_KINDS = new Set(['text', 'code', 'pdf', 'document', 'spreadsheet', 'presentation'])

const DEFAULT_OPTIONS = {
  maxContentBytes: 256 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxFiles: 2_000_000,
  maxDepth: 64
}

/**
 * @param {{ walker: object }} deps
 * @param {object} [options]
 */
function createIndexBuilder({ walker }, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options }
  let cancelled = false

  return {
    cancel() {
      cancelled = true
    },

    /**
     * Walk the given roots.
     * @param {string[]} roots absolute folder paths (drive roots)
     * @param {{ onProgress?: Function, exclusions?: Set<string> }} hooks
     */
    async run(roots, hooks = {}) {
      cancelled = false
      const records = []
      const visited = new Set()
      const started = Date.now()
      let folders = 0
      let contentRead = 0
      let skipped = 0

      const report = (extra = {}) => {
        if (typeof hooks.onProgress === 'function') {
          hooks.onProgress({
            files: records.length,
            folders,
            contentRead,
            skipped,
            elapsedMs: Date.now() - started,
            current: extra.current ?? null,
            done: extra.done ?? false,
            cancelled
          })
        }
      }

      const queue = roots.map((root) => ({ path: root, depth: 0 }))

      while (queue.length > 0) {
        if (cancelled) break
        if (records.length >= config.maxFiles) break

        const { path: dirPath, depth } = queue.shift()
        if (depth > config.maxDepth) continue
        if (visited.has(dirPath)) continue // a junction loop must not run forever
        visited.add(dirPath)
        if (shouldSkipFolder(dirPath, hooks.exclusions)) {
          skipped += 1
          continue
        }

        let entries
        try {
          entries = await walker.readdir(dirPath)
        } catch {
          // An unreadable folder is skipped, not fatal: a locked or disconnected
          // drive must not end the scan (FR-032).
          skipped += 1
          continue
        }

        folders += 1
        report({ current: dirPath })

        for (const entry of entries) {
          if (cancelled) break

          const fullPath = walker.join(dirPath, entry.name)

          if (entry.isDirectory) {
            queue.push({ path: fullPath, depth: depth + 1 })
            continue
          }

          const record = {
            path: fullPath,
            name: entry.name,
            nameTokens: tokenize(entry.name),
            size: entry.size ?? null,
            modifiedAt: entry.modifiedAt ?? null,
            kind: entry.kind ?? 'other',
            contentTokens: null
          }

          // Pass 2: contents, only for kinds worth reading and only when small enough.
          if (
            CONTENT_KINDS.has(record.kind) &&
            shouldIndexFile(entry.name, entry.size, config.maxFileBytes)
          ) {
            try {
              const text = await walker.readHead(fullPath, config.maxContentBytes)
              if (text) {
                record.contentTokens = tokenize(text)
                contentRead += 1
              }
            } catch {
              /* an unreadable file keeps its metadata and loses only its contents */
            }
          }

          records.push(record)
          if (records.length % 200 === 0) report({ current: dirPath })
        }
      }

      report({ done: true })
      return {
        records,
        stats: {
          files: records.length,
          folders,
          contentRead,
          skipped,
          elapsedMs: Date.now() - started,
          cancelled,
          roots,
          finishedAt: Date.now()
        }
      }
    }
  }
}

module.exports = { createIndexBuilder, CONTENT_KINDS, DEFAULT_OPTIONS }
