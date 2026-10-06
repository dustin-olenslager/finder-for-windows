'use strict'

/**
 * Use case: PerformFileOperation
 *
 * create-folder, rename, and move-to-trash. One entry point so the renderer has a
 * single IPC channel and the rules live in one place.
 *
 * Design decisions worth stating:
 *   - A rename or a move NEVER overwrites. Silently replacing a file is unrecoverable,
 *     so a clash is reported and the user chooses (spec FR-022).
 *   - Trash goes to the OS Recycle Bin, never an unlink, so every deletion is
 *     recoverable outside this app (D-0007).
 *   - The use case returns a SENTENCE on failure. The renderer never sees an errno.
 *
 * Ports used: FileOperations.
 */

const { validateName } = require('../domain/file-name')
const { normalizePath, parentOf, joinPath } = require('../domain/paths')

/**
 * @param {{ fileOperations: { mkdir: Function, rename: Function, trash: Function, exists: Function } }} deps
 * @param {{ op: string, path?: string, name?: string, target?: string }} request
 */
async function performFileOperation({ fileOperations }, request) {
  const op = request?.op

  try {
    switch (op) {
      case 'create-folder':
        return await createFolder(fileOperations, request)
      case 'rename':
        return await rename(fileOperations, request)
      case 'trash':
        return await trash(fileOperations, request)
      default:
        return { ok: false, error: `Unknown operation: ${op}` }
    }
  } catch (error) {
    return { ok: false, error: describeOperationFailure(error, request) }
  }
}

async function createFolder(fileOperations, request) {
  const parent = normalizePath(request.path)
  if (!parent) return { ok: false, error: 'A folder to create in is required.' }

  const checked = validateName(request.name)
  if (!checked.ok) return { ok: false, error: checked.error }

  const target = joinPath(parent, checked.name)
  if (await fileOperations.exists(target)) {
    return { ok: false, error: `There is already an item named "${checked.name}" here.` }
  }

  await fileOperations.mkdir(target)
  return { ok: true, op: 'create-folder', path: target, name: checked.name }
}

async function rename(fileOperations, request) {
  const from = normalizePath(request.path)
  if (!from) return { ok: false, error: 'An item to rename is required.' }

  const checked = validateName(request.name)
  if (!checked.ok) return { ok: false, error: checked.error }

  const parent = parentOf(from)
  if (!parent) return { ok: false, error: 'That item cannot be renamed.' }

  const target = joinPath(parent, checked.name)
  if (target === from) return { ok: true, op: 'rename', path: from, name: checked.name }

  if (await fileOperations.exists(target)) {
    return { ok: false, error: `There is already an item named "${checked.name}" here.` }
  }

  await fileOperations.rename(from, target)
  return { ok: true, op: 'rename', path: target, name: checked.name, from }
}

async function trash(fileOperations, request) {
  const target = normalizePath(request.path)
  if (!target) return { ok: false, error: 'An item to move to the Recycle Bin is required.' }

  // Refuse to trash a drive root: the Recycle Bin cannot hold one, and the failure
  // the OS returns for it is unhelpful.
  if (parentOf(target) === null) {
    return { ok: false, error: 'A drive cannot be moved to the Recycle Bin.' }
  }

  await fileOperations.trash(target)
  return { ok: true, op: 'trash', path: target }
}

/** Turn an errno into something a person can act on. */
function describeOperationFailure(error, request) {
  const code = error?.code
  const what = request?.name || request?.path || 'that item'
  switch (code) {
    case 'ENOENT':
      return `${what} no longer exists.`
    case 'EACCES':
    case 'EPERM':
      return `You do not have permission to change ${what}.`
    case 'EEXIST':
      return `Something with that name already exists.`
    case 'ENOTEMPTY':
      return 'That folder is not empty.'
    case 'EBUSY':
      return `${what} is in use by another program.`
    case 'EINVAL':
      return 'That name is not allowed by Windows.'
    case 'ENAMETOOLONG':
      return 'That name is too long.'
    default:
      return `Could not complete that change (${code || 'unknown error'}).`
  }
}

module.exports = { performFileOperation, describeOperationFailure }
