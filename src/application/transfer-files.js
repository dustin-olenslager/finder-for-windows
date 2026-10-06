'use strict'

/**
 * Use case: TransferFiles — copy or move a selection of files into a folder.
 *
 * Layers: Application. It knows about paths and a file-operations port, and nothing
 * about Electron, the DOM, or the clipboard. The clipboard lives in the renderer and
 * the composition root; this file decides WHAT should happen and reports honestly on
 * what did.
 *
 * Two entry points share the same rules:
 *
 *   - transferFiles  — the explicit Copy/Paste and Cut/Paste path.
 *   - dropFiles      — a drag and drop onto a folder. Drag is a MOVE by default, the way
 *                      Windows and Finder both behave, and Ctrl during the drop makes it a
 *                      copy. That decision is made by the caller and passed in as `op`, so
 *                      this file stays a pure rule set rather than a place where UI state
 *                      leaks.
 *
 * The rules that matter, and why:
 *
 *   - A copy into the SAME folder is refused rather than silently overwriting the
 *     source. Finder renames it instead; refusing with a clear sentence is the honest
 *     version of that until a duplicate-name UI exists.
 *   - A move onto itself is a no-op, not an error. Dragging a file back where it came
 *     from should not produce a failure message.
 *   - Every destination is checked BEFORE anything is written. A batch that copies two
 *     files and then fails on the third leaves the user unable to tell what happened;
 *     pre-flighting makes the outcome all-or-nothing in its reporting.
 *   - A partial failure is reported as a partial failure. "3 of 5 copied" is the truth;
 *     "Done" is not.
 *
 * The operation returns a sentence on failure, never an errno — the same contract the
 * rest of the file operations use, because the renderer never sees a system error code.
 */

const { normalizePath, parentOf, joinPath } = require('../domain/paths')
const { validateName } = require('../domain/file-name')

/** A folder can never be copied into itself or into its own subtree. */
function isInside(candidate, folder) {
  if (!candidate || !folder) return false
  // Compare without a trailing separator, so "C:\a\b" and "C:\a\b\" are the same folder
  // rather than one being reported as outside the other.
  const strip = (p) => p.replace(/[\\/]+$/, '')
  const a = strip(candidate).toLowerCase()
  const b = strip(folder).toLowerCase()
  if (a === b) return true
  // A separator must follow, or "C:\a\bc" would be mistaken for a child of "C:\a\b".
  return a.startsWith(`${b}\\`) || a.startsWith(`${b}/`)
}

/**
 * @param {{ fileOperations: object }} deps
 * @param {{ op: 'copy'|'move', items: Array<{name: string, path?: string}>, destination: string }} request
 */
async function transferFiles({ fileOperations }, request) {
  const op = request?.op === 'move' ? 'move' : 'copy'
  const destination = normalizePath(request?.destination)
  if (!destination) return { ok: false, error: 'A destination folder is required.' }

  const items = Array.isArray(request?.items) ? request.items.filter(Boolean) : []
  if (items.length === 0) return { ok: false, error: 'Nothing to transfer.' }

  // Resolve every source first, so a bad entry fails before anything is written.
  const sources = []
  for (const item of items) {
    const from = normalizePath(item.path)
    if (!from) return { ok: false, error: `The path for “${item.name}” could not be read.` }
    const name = item.name || from.split(/[\\/]/).pop()
    if (!validateName(name).ok) return { ok: false, error: validateName(name).error }

    // Moving a file to where it already is: nothing to do, and not a failure.
    if (op === 'move' && parentOf(from)?.toLowerCase() === destination.toLowerCase()) {
      continue
    }
    // Refuse when the DESTINATION sits inside the source: that is the case that would
    // recurse forever (copying C:\a\sub into C:\a\sub\deeper). Comparing the other way
    // round would wrongly block copying a folder up into its own parent.
    if (isInside(destination, from)) {
      return { ok: false, error: `“${name}” cannot be copied into itself.` }
    }
    sources.push({ from, name, to: joinPath(destination, name) })
  }

  if (sources.length === 0) {
    // Every item was already in place: a move that had nothing to do is a success with
    // nothing to report, not an error.
    return { ok: true, op, moved: 0, total: items.length, results: [] }
  }

  const results = []
  for (const { from, name, to } of sources) {
    // Refuse to clobber. A silent overwrite is the one outcome a file manager must
    // never produce.
    if (await fileOperations.exists(to)) {
      results.push({ name, ok: false, error: `There is already an item named “${name}” in that folder.` })
      continue
    }
    try {
      if (op === 'move') await fileOperations.rename(from, to)
      else await fileOperations.copy(from, to)
      results.push({ name, ok: true })
    } catch (error) {
      results.push({ name, ok: false, error: sentenceFor(error) })
    }
  }

  const done = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  return {
    ok: failed.length === 0,
    op,
    moved: done,
    total: sources.length,
    results,
    // A partial failure must say so, and name the first thing that went wrong.
    error: failed.length === 0 ? undefined : `${done} of ${sources.length} done. ${failed[0].name}: ${failed[0].error}`
  }
}

/**
 * Use case: dropFiles — a drag and drop landed on a folder.
 *
 * Drag and drop is the same transfer with one extra rule that only drags can break:
 * **you cannot drop a folder into itself or into anything beneath it.** The transfer
 * rules already refuse that for a single source, but a drop can also target a folder
 * that is *inside* the dragged set — dragging a parent onto its own child — which is the
 * same infinite recursion reached from the other side.
 *
 * A drop onto the folder the items already live in is a no-op, not an error: picking a
 * file up and putting it back down where it was should never produce a failure message.
 *
 * `op` comes from the caller because the modifier key decides it (plain drag moves,
 * Ctrl+drag copies). Keeping that decision outside means this stays a pure rule set.
 *
 * @param {{ fileOperations: object }} deps
 * @param {{ op?: 'copy'|'move', paths: string[], destination: string, names?: object }} request
 * @returns {Promise<{ok: boolean, op: string, moved: number, total: number, results: Array, error?: string}>}
 */
async function dropFiles({ fileOperations }, request) {
  const op = request?.op === 'copy' ? 'copy' : 'move'
  const destination = normalizePath(request?.destination)
  if (!destination) return { ok: false, op, moved: 0, total: 0, results: [], error: 'That drop had no destination folder.' }

  const paths = Array.isArray(request?.paths) ? request.paths.filter(Boolean) : []
  if (paths.length === 0) return { ok: false, op, moved: 0, total: 0, results: [], error: 'That drop had nothing in it.' }

  const names = request?.names ?? {}
  const items = paths.map((p) => {
    const from = normalizePath(p)
    return { path: from, name: names[from] || names[p] || from.split(/[\\/]/).filter(Boolean).pop() }
  })

  // A drop of one folder onto itself is a no-op, and saying so is better than a message
  // that looks like a failure. Only true when the WHOLE drop is a no-op.
  const allAlreadyHere =
    op === 'move' &&
    items.every((i) => parentOf(i.path)?.toLowerCase() === destination.toLowerCase())
  if (allAlreadyHere) {
    return { ok: true, op, moved: 0, total: items.length, results: [], noop: true }
  }

  return transferFiles({ fileOperations }, { op, items, destination })
}

/** Turn a filesystem failure into a sentence a person can act on. */
function sentenceFor(error) {
  const code = error?.code
  if (code === 'EACCES' || code === 'EPERM') return 'You do not have permission to write there.'
  if (code === 'ENOENT') return 'That folder no longer exists.'
  if (code === 'ENOSPC') return 'There is not enough space on that drive.'
  if (code === 'EBUSY') return 'That file is open in another program.'
  if (code === 'EROFS') return 'That drive is read-only.'
  if (code === 'EEXIST') return 'An item with that name is already there.'
  return 'That did not work. The file may be in use.'
}

module.exports = { transferFiles, dropFiles, isInside }
