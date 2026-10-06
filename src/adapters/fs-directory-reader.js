'use strict'

/**
 * Adapter: FsDirectoryReader — implements the DirectoryReader port.
 *
 * Layers: Interface Adapters. This is the ONLY place in the app that knows a filesystem
 * API exists.
 *
 * ## Two routes, and why the fast one matters
 *
 * A naive reader lists a directory and then asks the filesystem about each entry in turn.
 * That is one system call per file, so a folder of 200,000 items is 200,000 calls — fine
 * at ten thousand, visibly slow at two hundred thousand, and it is the single biggest
 * cost in opening a big folder.
 *
 * Windows can answer for the WHOLE directory in one call. This adapter already had to
 * make that call for attribute flags (hidden / system / cloud-placeholder), which Node's
 * `fs.Stats` does not expose at all — so the expensive per-entry stats were being paid on
 * top of a process spawn that was happening anyway. Asking that same call for size, times
 * and the directory flag as well removes every per-entry call on Windows:
 *
 *   before:  1 process spawn + N stat calls
 *   after:   1 process spawn
 *
 * The per-entry route remains as the fallback — non-Windows, PowerShell unavailable, or
 * the call failing — so the reader is correct everywhere and only fast on Windows.
 *
 * ## Platform notes that live here because this is the boundary
 *
 *   - A cloud placeholder's CONTENTS must never be read: opening one hydrates it, which
 *     downloads a file the user only wanted to see the name of (spec FR-027). Nothing in
 *     this file opens a file.
 *   - NTFS returns entries in B-tree order, which must never be presented as if it were
 *     sorted, so the result is sorted deterministically here.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { kindOf } = require('../domain/file-kind')

// Windows file attributes.
const FILE_ATTRIBUTE_HIDDEN = 0x2
const FILE_ATTRIBUTE_SYSTEM = 0x4
// A cloud placeholder that is not present locally. RECALL_ON_DATA_ACCESS (0x400000)
// replaced OFFLINE (0x1000) as the marker around 2019; both are checked.
const FILE_ATTRIBUTE_OFFLINE = 0x1000
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000

/** .NET ticks (100ns since 1601-01-01) to Unix milliseconds. */
const TICKS_TO_UNIX_MS = 116444736000000000n

/** `execFile` as a promise with a hard timeout, so one slow drive cannot hang a read. */
function exec(command, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout) })
    })
  })
}

/** A single-quoted PowerShell literal, with embedded quotes doubled. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

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

/**
 * The PowerShell that enumerates one directory completely, in one call.
 *
 * `[System.IO.DirectoryInfo]::EnumerateFileSystemInfos()` is used rather than
 * `Get-ChildItem` on purpose: Get-ChildItem builds a full PowerShell object per entry,
 * which for a large folder costs far more than the enumeration itself. The .NET call
 * hands back the raw filesystem info.
 *
 * Times are emitted as raw .NET TICKS, not formatted dates. A formatted date would have
 * to be parsed back, and its format depends on the machine's culture — ticks are an
 * integer and cannot be misread.
 *
 * The NAME is emitted LAST because a Windows filename may legally contain a tab (it may
 * NOT contain a newline or any control character, so splitting on lines is safe). With
 * the name last, the first five fields split cleanly and the name is whatever remains,
 * tabs and all.
 */
function bulkEnumerationScript(dirPath) {
  return [
    '$ErrorActionPreference = "Stop"',
    `$d = [System.IO.DirectoryInfo]::new(${psQuote(dirPath)})`,
    'foreach ($e in $d.EnumerateFileSystemInfos()) {',
    '  $isDir = if ($e -is [System.IO.DirectoryInfo]) { 1 } else { 0 }',
    '  $len = if ($isDir -eq 1) { 0 } else { $e.Length }',
    '  "{0}`t{1}`t{2}`t{3}`t{4}`t{5}" -f $isDir, $len, $e.LastWriteTimeUtc.Ticks, $e.CreationTimeUtc.Ticks, [int]$e.Attributes, $e.Name',
    '}'
  ].join('\n')
}

/** Ticks (a decimal string) to Unix milliseconds, or null if it is not a number. */
function ticksToMs(ticks) {
  if (!/^\d+$/.test(String(ticks ?? ''))) return null
  try {
    return Number((BigInt(ticks) - TICKS_TO_UNIX_MS) / 10000n)
  } catch {
    return null
  }
}

/**
 * Parse the bulk output into entries. Pure, so it is tested without PowerShell.
 *
 * A malformed line is skipped rather than throwing: one unreadable entry must not cost
 * the user the whole folder.
 */
function parseBulkOutput(stdout) {
  const entries = []
  for (const rawLine of String(stdout ?? '').split(/\r?\n/)) {
    if (rawLine === '') continue
    const parts = rawLine.split('\t')
    if (parts.length < 6) continue

    // The name is everything after the fifth tab, so a name containing a tab survives.
    const name = parts.slice(5).join('\t')
    if (name === '') continue

    const attributes = Number.parseInt(parts[4], 10)
    entries.push({
      name,
      isDirectory: parts[0] === '1',
      size: Number.parseInt(parts[1], 10),
      modifiedAt: ticksToMs(parts[2]),
      createdAt: ticksToMs(parts[3]),
      attributes: Number.isFinite(attributes) ? attributes : 0
    })
  }
  return entries
}

/**
 * Enumerate a directory completely, in one call. Returns null when the bulk route is
 * unavailable, so the caller falls back rather than failing.
 */
async function readWindowsEntries(dirPath) {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      bulkEnumerationScript(dirPath)
    ])
    return parseBulkOutput(stdout)
  } catch {
    // PowerShell unavailable, the folder is unreadable, or the call timed out. The
    // per-entry route still works, so this is a fallback, never a failure.
    return null
  }
}

/** One bulk entry to the FileItem the rest of the app reads. */
function fromBulkEntry(entry) {
  return {
    name: entry.name,
    isDirectory: entry.isDirectory,
    size: entry.isDirectory ? null : (Number.isFinite(entry.size) ? entry.size : null),
    modifiedAt: entry.modifiedAt,
    createdAt: entry.createdAt,
    kind: entry.isDirectory ? 'folder' : kindOf(entry.name),
    isHidden: isHidden(entry.attributes, entry.name),
    isCloudPlaceholder: isCloudPlaceholder(entry.attributes),
    metadataUnavailable: false
  }
}

/** Map one directory entry + its stat into a plain FileItem. The fallback route. */
async function toFileItem(entry, dirPath, attributesByName = null) {
  const fullPath = path.join(dirPath, entry.name)
  const known = attributesByName ? attributesByName.get(entry.name.toLowerCase()) : undefined
  let stat = null
  try {
    stat = await fs.lstat(fullPath)
  } catch {
    // An entry that vanished between readdir and lstat, or that cannot be stat'd:
    // report it as an item with unknown metadata rather than dropping it.
    return {
      name: entry.name,
      isDirectory: entry.isDirectory(),
      size: null,
      modifiedAt: null,
      createdAt: null,
      kind: entry.isDirectory() ? 'folder' : kindOf(entry.name),
      isHidden: isHidden(known ?? 0, entry.name),
      isCloudPlaceholder: false,
      metadataUnavailable: true
    }
  }

  const attributes = known ?? 0
  const isDirectory = stat.isDirectory()
  return {
    name: entry.name,
    isDirectory,
    size: isDirectory ? null : stat.size,
    modifiedAt: stat.mtimeMs,
    createdAt: stat.birthtimeMs || null,
    kind: isDirectory ? 'folder' : kindOf(entry.name),
    isHidden: isHidden(attributes, entry.name),
    isCloudPlaceholder: isCloudPlaceholder(attributes),
    metadataUnavailable: false
  }
}

/** Ask Windows only for attribute flags. The fallback route's attribute source. */
async function readWindowsAttributes(dirPath) {
  if (process.platform !== 'win32') return null
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `Get-ChildItem -LiteralPath ${psQuote(dirPath)} -Force |`,
    '  Select-Object Name, Attributes |',
    '  ForEach-Object { "{0}`t{1}" -f $_.Name, [int]$_.Attributes }'
  ].join(' ')
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 5000
    })
    const map = new Map()
    for (const line of stdout.split(/\r?\n/)) {
      const tab = line.lastIndexOf('\t')
      if (tab <= 0) continue
      const name = line.slice(0, tab)
      const bits = Number.parseInt(line.slice(tab + 1), 10)
      if (Number.isFinite(bits)) map.set(name.toLowerCase(), bits)
    }
    return map.size > 0 ? map : null
  } catch {
    return null
  }
}

/** Deterministic order: folders first, then names, case-insensitive, numerals as numbers. */
function byFolderThenName(a, b) {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
}

function createFsDirectoryReader() {
  return {
    async read(dirPath) {
      // Route 1: one call for the whole directory. This is the fast path and the reason
      // a 200k-file folder is usable.
      const bulk = await readWindowsEntries(dirPath)
      if (bulk !== null) {
        const items = bulk.map(fromBulkEntry)
        items.sort(byFolderThenName)
        return items
      }

      // Route 2: list, then ask about each entry. Correct everywhere, slower on Windows.
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const attributesByName = await readWindowsAttributes(dirPath)
      const items = await Promise.all(entries.map((entry) => toFileItem(entry, dirPath, attributesByName)))
      items.sort(byFolderThenName)
      return items
    }
  }
}

module.exports = {
  createFsDirectoryReader,
  isCloudPlaceholder,
  isHidden,
  toFileItem,
  // Exported for testing: the parser is pure and the script is worth pinning.
  parseBulkOutput,
  bulkEnumerationScript,
  ticksToMs,
  fromBulkEntry,
  byFolderThenName
}
