'use strict'

/**
 * Adapter: FsDirectoryReader — implements the DirectoryReader port with Node's fs.
 *
 * Layers: Interface Adapters. This is the ONLY place in the app that knows Node's
 * filesystem API exists. Swapping it for the native bulk-enumeration adapter (M6)
 * changes this file and the composition root, and nothing else.
 *
 * Windows-specific notes baked in here because this is the boundary that touches
 * the platform:
 *   - Attribute flags (hidden/system) and cloud-placeholder state come from the
 *     entry's file attributes; reading a placeholder's CONTENTS would hydrate it,
 *     so this adapter never opens a file (spec FR-027).
 *   - Entries are returned in a deterministic order; NTFS itself returns B-tree
 *     order, which must never be presented as if it were sorted.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { kindOf } = require('../domain/file-kind')

// Windows file attributes. Present on the stat object on Windows only; on other
// platforms these stay 0 and the corresponding checks fall through.
const FILE_ATTRIBUTE_HIDDEN = 0x2
const FILE_ATTRIBUTE_SYSTEM = 0x4
// A cloud placeholder that is not present locally. RECALL_ON_DATA_ACCESS (0x400000)
// replaced OFFLINE (0x1000) as the marker around 2019; both are checked.
const FILE_ATTRIBUTE_OFFLINE = 0x1000
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000

function isCloudPlaceholder(attributes) {
  return (
    (attributes & FILE_ATTRIBUTE_OFFLINE) !== 0 ||
    (attributes & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) !== 0 ||
    (attributes & FILE_ATTRIBUTE_RECALL_ON_OPEN) !== 0
  )
}

function isHidden(attributes, name) {
  // A dotfile is hidden on every platform; Windows also marks it with an attribute.
  return name.startsWith('.') || (attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) !== 0
}

/** Map one directory entry + its stat into a plain FileItem domain value. */
async function toFileItem(entry, dirPath) {
  const fullPath = path.join(dirPath, entry.name)
  let stat = null
  try {
    stat = await fs.lstat(fullPath)
  } catch {
    // A entry that vanished between readdir and lstat, or that we cannot stat:
    // report it as an item with unknown metadata rather than dropping it.
    return {
      name: entry.name,
      isDirectory: entry.isDirectory(),
      size: null,
      modifiedAt: null,
      createdAt: null,
      kind: entry.isDirectory() ? 'folder' : kindOf(entry.name),
      isHidden: isHidden(0, entry.name),
      isCloudPlaceholder: false,
      metadataUnavailable: true
    }
  }

  const attributes = stat.attributes ?? 0
  const isDirectory = stat.isDirectory()
  return {
    name: entry.name,
    isDirectory,
    size: isDirectory ? null : stat.size,
    // `modifiedAt` (milliseconds) is the name the renderer reads; keep the field name
    // identical on every path out of this adapter so a column can never go blank.
    modifiedAt: stat.mtimeMs,
    // NTFS keeps a real creation time, so this is worth showing. It can be later than
    // the modified time after a copy, which is the filesystem's answer, not a bug.
    createdAt: stat.birthtimeMs || null,
    kind: isDirectory ? 'folder' : kindOf(entry.name),
    isHidden: isHidden(attributes, entry.name),
    isCloudPlaceholder: isCloudPlaceholder(attributes),
    metadataUnavailable: false
  }
}

function createFsDirectoryReader() {
  return {
    async read(dirPath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const items = await Promise.all(entries.map((entry) => toFileItem(entry, dirPath)))

      // Deterministic order: folders first, then names, case-insensitive.
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
      })

      return items
    }
  }
}

module.exports = { createFsDirectoryReader, isCloudPlaceholder, isHidden, toFileItem }
