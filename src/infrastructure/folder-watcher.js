'use strict'

/**
 * FolderWatcher — notice when a folder on screen changes.
 *
 * Layers: Interface Adapters. It knows about the filesystem and nothing about Electron,
 * the DOM, or IPC; the composition root injects what to do when something changes.
 *
 * ## Why this is not just `fs.watch`
 *
 * `fs.watch` is the obvious answer and it is not sufficient. On Windows it maps to
 * `ReadDirectoryChangesW`, which reports changes on a LOCAL NTFS volume and does not on a
 * network share or a virtual drive. Google Drive's mounted drive is the case that matters
 * here: `fs.watch` on `G:\Shared drives\...` succeeds, returns a watcher, and then never
 * fires — so a new file appears only after navigating away and back. A silent no-op is the
 * worst kind of failure, because the code looks correct.
 *
 * So there are two mechanisms, and they cover each other:
 *
 *   1. `fs.watch` — instant, cheap, and correct on local disks.
 *   2. A poll that compares the folder's LISTING (names, and which are folders) against
 *      the last one seen. This works on every drive type because it does not depend on the
 *      filesystem reporting anything; it just looks.
 *
 * The poll re-reads directory NAMES, not file contents, so it stays cheap: a `readdir` of
 * a folder with a few hundred entries is a fraction of a millisecond. It is the same
 * primitive the listing itself uses.
 *
 * ## Two rules that keep it from misbehaving
 *
 * - **Seeding never fires.** The first observation of a folder records what is there and
 *   stays quiet. Firing on the seed would mean every folder open triggers a refresh of
 *   itself, which is a loop.
 * - **A change is only reported once.** The signature is stored before the callback runs,
 *   so the refresh that follows does not look like another change.
 */

/** How often to look. A `readdir` of NAMES is cheap, so this can be brisk. */
const POLL_INTERVAL_MS = 1000

/** How long to wait after a change before reporting it. */
const DEBOUNCE_MS = 250

/**
 * @param {() => void} onChange called (debounced) when a watched folder changes
 * @param {{ intervalMs?: number, debounceMs?: number, fsModule?: object }} [options]
 */
function createFolderWatcher(onChange, options = {}) {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const fsModule = options.fsModule ?? require('node:fs')

  /** path -> the fs.FSWatcher, where one could be created at all. */
  const watchers = new Map()
  /** path -> the last listing seen. Presence here is what "watched" means. */
  const signatures = new Map()
  /** path -> true while the first listing is still being read. */
  const seeding = new Set()

  let debounceTimer = null
  let pollTimer = null
  let closed = false
  /** True while a poll pass is still running, so passes cannot overlap. */
  let polling = false

  /**
   * A folder's listing, as a string that changes when the folder changes.
   *
   * Names plus a trailing slash for folders: enough to notice an added, removed or
   * renamed entry, and enough to notice a file becoming a folder. Deliberately NOT
   * mtimes — a virtual drive may not update a directory's mtime when its contents
   * change, which is the whole reason this poll exists.
   */
  async function signatureOf(target) {
    try {
      const entries = await fsModule.promises.readdir(target, { withFileTypes: true })
      return entries.map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`).sort().join('\n')
    } catch {
      // An unreadable folder has no signature. Returning null means "leave the previous
      // one alone" rather than "it changed", so a blip cannot masquerade as a change.
      return null
    }
  }

  const fire = () => {
    // A file is usually written in several steps, so one save can arrive as several
    // events. Coalescing keeps the UI from re-listing the folder repeatedly.
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!closed) onChange()
    }, debounceMs)
  }

  async function seed(target) {
    seeding.add(target)
    const signature = await signatureOf(target)
    seeding.delete(target)
    // Only record it if the folder is still watched: it may have been dropped, or the
    // whole watcher closed, while the read was in flight.
    if (signatures.has(target) && signature !== null) signatures.set(target, signature)
  }

  async function poll() {
    // A readdir on a network or virtual drive can take longer than the interval. Without
    // this guard the passes would pile up, each waiting on the last, and a drive that got
    // slow would take the app down with it. Skipping a pass is safe: the next one sees
    // whatever the slow one missed.
    if (closed || polling) return
    polling = true
    try {
      await pollOnce()
    } finally {
      polling = false
    }
  }

  async function pollOnce() {
    for (const target of [...signatures.keys()]) {
      // Skip a folder whose seed is still in flight, or the seed would be compared
      // against itself and could report a change that never happened.
      if (seeding.has(target)) continue

      const next = await signatureOf(target)
      if (next === null) continue // unreadable right now; keep the last known listing

      const previous = signatures.get(target)
      if (previous !== undefined && next !== previous) {
        // Store BEFORE firing, so the refresh this triggers is not seen as another change.
        signatures.set(target, next)
        fire()
      } else {
        signatures.set(target, next)
      }
    }
  }

  function startPolling() {
    if (pollTimer || closed) return
    pollTimer = setInterval(() => {
      poll().catch(() => {})
    }, intervalMs)
    // A watcher must never be the reason the app stays alive after its window closes.
    if (typeof pollTimer.unref === 'function') pollTimer.unref()
  }

  function stopPolling() {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  return {
    /**
     * Watch exactly this set of folders, dropping any no longer on screen.
     *
     * Watching the folders being VIEWED — rather than a whole drive — is the smallest
     * shape that answers the real question, and it cannot exhaust Windows' limit on
     * change handles, which a recursive whole-drive watch does (it then stops reporting
     * silently).
     */
    set(paths) {
      if (closed) return
      const wanted = new Set((paths || []).filter(Boolean))

      for (const [target, watcher] of watchers) {
        if (!wanted.has(target)) {
          watcher.close()
          watchers.delete(target)
        }
      }
      for (const target of [...signatures.keys()]) {
        if (!wanted.has(target)) signatures.delete(target)
      }

      for (const target of wanted) {
        if (signatures.has(target)) continue
        // Register BEFORE seeding, so `signatures.has()` is the single definition of
        // "watched" and the seed has somewhere to write its result.
        signatures.set(target, undefined)
        seed(target).catch(() => {})

        try {
          // persistent:false so a watcher never holds the app open on its own.
          const watcher = fsModule.watch(target, { persistent: false }, fire)
          watcher.on('error', () => {
            // A watcher that fails is not an error worth showing: the poll still covers
            // this folder, so the listing stays live either way.
            watcher.close()
            watchers.delete(target)
          })
          watchers.set(target, watcher)
        } catch {
          // No native watcher here (a virtual or network drive, or a permissions quirk).
          // The poll is the whole mechanism for this folder, which is the point of it.
        }
      }

      if (signatures.size > 0) startPolling()
      else stopPolling()
    },

    /** The folders currently watched. Useful for a status readout and for tests. */
    watched() {
      return [...signatures.keys()]
    },

    /** Look now, without waiting for the interval. Used by tests and by a manual refresh. */
    checkNow() {
      return poll()
    },

    close() {
      closed = true
      stopPolling()
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = null
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
      signatures.clear()
      seeding.clear()
    }
  }
}

module.exports = { createFolderWatcher, POLL_INTERVAL_MS, DEBOUNCE_MS }
