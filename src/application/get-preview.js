'use strict'

/**
 * Use case: GetPreview
 *
 * Decides HOW an item can be previewed, and returns the payload for the kinds this
 * app renders itself. Anything it cannot render is handed to the OS (the renderer
 * calls open-with-default), which is the honest answer rather than a blank pane.
 *
 * Ports used: FileReader (through ReadTextHead).
 */

const path = require('node:path')
const { kindOf, extensionOf, isPreviewable } = require('../domain/file-kind')
const { readTextHead } = require('./read-text-head')

/** Kinds this app renders inline. Everything else is 'system' or 'none'. */
const INLINE = new Set(['image', 'video', 'audio', 'pdf', 'text', 'code'])

/**
 * @param {{ fileReader: object }} deps
 * @param {string} filePath
 * @param {string} [name] the display name, when the caller already has it
 */
async function getPreview({ fileReader }, filePath, name) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return { ok: false, error: 'A file path is required.' }
  }

  const fileName = name || path.basename(filePath)
  const kind = kindOf(fileName)
  const extension = extensionOf(fileName)

  if (!INLINE.has(kind)) {
    return {
      ok: true,
      mode: 'system',
      kind,
      extension,
      // The UI states this plainly instead of showing an empty box.
      note: isPreviewable(kind) ? 'Opens in another app.' : 'No preview for this file type.'
    }
  }

  if (kind === 'text' || kind === 'code') {
    const result = await readTextHead({ fileReader }, filePath)
    if (!result.ok) {
      // A file we cannot read is not a broken preview — hand it to the OS.
      return { ok: true, mode: 'system', kind, extension, note: result.error }
    }
    return {
      ok: true,
      mode: 'text',
      kind,
      extension,
      text: result.text,
      truncated: result.truncated,
      looksBinary: result.looksBinary
    }
  }

  // image / video / audio / pdf: the renderer gets a file URL and Chromium renders it.
  return { ok: true, mode: kind, kind, extension }
}

module.exports = { getPreview, INLINE }
