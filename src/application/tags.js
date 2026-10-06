'use strict'

/**
 * Use case: Tags — the app's own tag store.
 *
 * Windows has no cross-application metadata store, so tags live here and are keyed by
 * the file's path plus its size and modified time. That triple is deliberate: a path
 * alone is reused when a file is deleted and a new one takes its name, and the app must
 * not silently show a new file wearing a dead file's tags. When the signature changes,
 * the old tags are treated as stale rather than applied.
 *
 * Tags are visible only inside this app, and the UI says so (FR-017).
 *
 * Ports used: store (readState/writeState).
 */

const DEFAULT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']

function createTagService({ store }) {
  /** signature(path, size, modifiedAt) -> stable key for a file's identity */
  const signature = (record) => `${record.path}|${record.size ?? ''}|${record.modifiedAt ?? ''}`

  async function readAll() {
    const state = await store.readState()
    return state.tags ?? {}
  }

  return {
    signature,

    async listFor(records) {
      const tags = await readAll()
      const out = {}
      for (const record of records) {
        const key = signature(record)
        if (tags[key]) out[record.path] = tags[key]
      }
      return out
    },

    async listAll() {
      const tags = await readAll()
      const byTag = {}
      for (const [key, names] of Object.entries(tags)) {
        const path = key.split('|')[0]
        for (const name of names) {
          byTag[name] = byTag[name] ?? []
          byTag[name].push(path)
        }
      }
      return byTag
    },

    async assign(record, tagName) {
      const name = String(tagName ?? '').trim()
      if (name === '') return { ok: false, error: 'A tag needs a name.' }

      const state = await store.readState()
      const tags = state.tags ?? {}
      const key = signature(record)
      const current = new Set(tags[key] ?? [])
      current.add(name)
      tags[key] = [...current]
      await store.writeState({ ...state, tags })
      return { ok: true, path: record.path, tags: tags[key] }
    },

    async remove(record, tagName) {
      const state = await store.readState()
      const tags = state.tags ?? {}
      const key = signature(record)
      const current = (tags[key] ?? []).filter((t) => t !== tagName)
      if (current.length === 0) delete tags[key]
      else tags[key] = current
      await store.writeState({ ...state, tags })
      return { ok: true, path: record.path, tags: current }
    },

    /** Drop every tag whose file no longer exists. Called after a scan. */
    async prune(existingPaths) {
      const state = await store.readState()
      const tags = state.tags ?? {}
      const keep = {}
      let removed = 0
      for (const [key, names] of Object.entries(tags)) {
        const path = key.split('|')[0]
        if (existingPaths.has(path.toLowerCase())) keep[key] = names
        else removed += 1
      }
      if (removed > 0) await store.writeState({ ...state, tags: keep })
      return { removed, kept: Object.keys(keep).length }
    },

    colors: DEFAULT_COLORS
  }
}

module.exports = { createTagService, DEFAULT_COLORS }
