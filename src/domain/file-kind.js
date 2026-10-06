'use strict'

/**
 * File kinds. Domain layer — pure classification, no I/O.
 *
 * One place decides what a file IS, so the icon, the preview route and the "Kind"
 * column all agree. Extensions are matched case-insensitively, longest first, so
 * ".tar.gz" wins over ".gz".
 */

/** Ordered: the longest matching extension wins. */
const EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff'],
  pdf: ['pdf'],
  document: ['doc', 'docx', 'odt', 'rtf', 'pages'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'tar.gz', 'tar.bz2'],
  code: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash', 'ps1', 'psm1', 'bat', 'cmd', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'env', 'vue', 'svelte'],
  text: ['txt', 'md', 'markdown', 'log', 'rst', 'text', 'nfo'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  executable: ['exe', 'msi', 'dll', 'appx', 'msix', 'apk', 'deb', 'rpm', 'dmg', 'pkg'],
  disk: ['vhd', 'vhdx', 'vmdk', 'img'],
  shortcut: ['lnk', 'url', 'webloc']
}

/** extension -> kind, built once, longest extension first within each kind. */
const LOOKUP = new Map()
for (const [kind, extensions] of Object.entries(EXTENSIONS)) {
  for (const extension of extensions) LOOKUP.set(extension, kind)
}

/** The lowercased extension without the dot, or '' when there is none. */
function extensionOf(name) {
  const base = String(name)
  const index = base.lastIndexOf('.')
  // A leading dot is a dotfile, not an extension (".gitignore" has none).
  if (index <= 0 || index === base.length - 1) return ''
  return base.slice(index + 1).toLowerCase()
}

/**
 * Two-part extensions ("tar.gz") matter for archives, so try the compound form
 * before the simple one.
 */
function kindOf(name) {
  const base = String(name).toLowerCase()
  for (const extension of LOOKUP.keys()) {
    if (extension.includes('.') && base.endsWith(`.${extension}`)) return LOOKUP.get(extension)
  }
  return LOOKUP.get(extensionOf(name)) ?? 'other'
}

/** True when this kind can be rendered inline by the preview pane. */
function isPreviewable(kind) {
  return ['image', 'video', 'audio', 'pdf', 'text', 'code'].includes(kind)
}

module.exports = { kindOf, extensionOf, isPreviewable, EXTENSIONS }
