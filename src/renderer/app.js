'use strict'

/**
 * The renderer: view state and presentation only.
 *
 * It never touches the filesystem. Every listing, preview and mutation arrives
 * through window.finder, which the preload exposes over IPC. Path arithmetic is done
 * by the main process (src/domain/paths.js) — the renderer never guesses separators.
 */

// ---------------------------------------------------------------------------
// Element handles
// ---------------------------------------------------------------------------

const el = {
  back: document.getElementById('back'),
  forward: document.getElementById('forward'),
  up: document.getElementById('up'),
  title: document.getElementById('folderTitle'),
  content: document.getElementById('content'),
  sidebar: document.getElementById('sidebar'),
  search: document.getElementById('search'),
  statusCount: document.getElementById('statusCount'),
  statusPath: document.getElementById('statusPath'),
  announcer: document.getElementById('announcer'),
  alerts: document.getElementById('alerts'),
  breadcrumb: document.getElementById('breadcrumb'),
  preview: document.getElementById('preview'),
  previewBody: document.getElementById('previewBody'),
  previewName: document.getElementById('previewName'),
  previewMeta: document.getElementById('previewMeta'),
  previewToggle: document.getElementById('previewToggle'),
  previewClose: document.getElementById('previewClose'),
  previewPrev: document.getElementById('previewPrev'),
  previewNext: document.getElementById('previewNext'),
  previewSteps: document.getElementById('previewSteps'),
  mediaCount: document.getElementById('mediaCount'),
  sortBtn: document.getElementById('sortBtn'),
  sortLabel: document.getElementById('sortLabel'),
  filterBtn: document.getElementById('filterBtn'),
  filterLabel: document.getElementById('filterLabel'),
  patternBar: document.getElementById('patternBar'),
  patternInput: document.getElementById('patternInput'),
  patternClear: document.getElementById('patternClear'),
  filterClear: document.getElementById('filterClear'),
  pasteHint: document.getElementById('pasteHint'),
  searchClear: document.getElementById('searchClear'),
  scope: document.getElementById('scope'),
  scopeWrap: document.getElementById('scopeWrap'),
  searchbar: document.getElementById('searchbar'),
  searchSummary: document.getElementById('searchSummary'),
  searchExit: document.getElementById('searchExit'),
  indexbar: document.getElementById('indexbar'),
  indexText: document.getElementById('indexText'),
  indexAction: document.getElementById('indexAction'),
  indexDismiss: document.getElementById('indexDismiss'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  zoomValue: document.getElementById('zoomValue'),
  quicklookBtn: document.getElementById('quicklookBtn'),
  quicklook: document.getElementById('quicklook'),
  quicklookBody: document.getElementById('quicklookBody'),
  quicklookName: document.getElementById('quicklookName'),
  quicklookMeta: document.getElementById('quicklookMeta'),
  quicklookSteps: document.getElementById('quicklookSteps'),
  quicklookCount: document.getElementById('quicklookCount'),
  quicklookPrev: document.getElementById('quicklookPrev'),
  quicklookNext: document.getElementById('quicklookNext'),
  quicklookClose: document.getElementById('quicklookClose'),
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Column view is the default: it is the view that defines Finder. */
const state = {
  view: 'column',
  columns: [], // [{ path, items, selectedName }] — one entry per Miller column
  filter: '',
  // How the folder is ordered. Folders stay above files whatever this says.
  sort: { key: 'name', ascending: true },
  // Type filter: a SET of kinds, so "video and prompt text" is expressible.
  kindFilter: new Set(),
  // A name pattern, for the shot-naming case: "V003" or "_VO" narrows a version folder.
  pattern: '',
  selected: null, // { name, isDirectory, kind, path } — the LEAD item
  // Every selected item. `selected` is always one of these (or null); this is what
  // batch operations act on.
  selection: [],
  anchorName: null, // where Shift+click extends a range from
  activeTag: null, // the tag whose files are being shown, if any
  tags: {}, // every tag and its files
  // The in-app file clipboard: { op: 'copy'|'move', items: [{name, path}] }.
  clipboard: null,
  // The answer given to "these already exist", remembered for the session. Cleared when
  // the user asks for the dialog back from the View menu.
  conflictChoice: null,
  // Hidden files are off by default, as they are in Explorer: the attribute exists to keep
  // things out of the way, so a file manager that always showed them would ignore it.
  showHidden: false,
  activeSidebar: null,
  // ON by default. A preview nobody can find is not a feature: the first version only
  // opened it on a shortcut, so the owner saw no previews at all.
  previewOpen: true,
  quickLookOpen: false,

  // Search. `searchText` is non-empty only while results are being shown; the folder
  // listing and the results never share the content area.
  searchText: '',
  searchScope: 'everywhere',
  searchResults: [],
  searchTotal: 0,
  searchBusy: false,

  // Index coverage, as reported by the last scan.
  index: { known: false, running: false, files: 0, folders: 0, elapsedMs: 0, finishedAt: null, current: null },

  // Interface size. Held as an index into ZOOM_STEPS so the ladder is the only truth.
  zoomIndex: 3
}

let backStack = []
let forwardStack = []
/** Guards against a stale preview landing after the selection has moved on. */
let previewToken = 0

function activePath() {
  const last = state.columns[state.columns.length - 1]
  return last ? last.path : null
}

function activeColumn() {
  return state.columns[state.columns.length - 1] ?? null
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

/**
 * What is currently being dragged.
 *
 * A module-level value rather than `dataTransfer` state, because `dataTransfer.getData`
 * is deliberately unreadable during `dragover` — the browser hides the payload until the
 * drop actually happens. We need to know what is in flight while the pointer is still
 * moving, to decide whether a folder may accept it.
 */
let dragState = null

/** Every element currently wearing the drop-target highlight. */
const dropTargets = new Set()

function clearDropTargets() {
  for (const node of dropTargets) node.classList.remove('is-drop-target')
  dropTargets.clear()
}

function markDropTarget(node) {
  if (!node || dropTargets.has(node)) return
  clearDropTargets()
  node.classList.add('is-drop-target')
  dropTargets.add(node)
}

/**
 * The folder a drop at this point should land in, or null.
 *
 * Resolution order matters: a folder row wins over the column behind it, and the column
 * wins over the view background. Returns { path, node }.
 */
function dropDestinationAt(target) {
  const row = target.closest?.('.row.is-dir, .icon-cell.is-dir')
  if (row) {
    const item = itemForNode(row)
    if (item?.path) return { path: item.path, node: row }
    return null
  }

  const sidebarItem = target.closest?.('.sidebar-item')
  if (sidebarItem?.dataset.path) {
    return { path: sidebarItem.dataset.path, node: sidebarItem }
  }

  const pane = target.closest?.('.column')
  if (pane?.dataset.path) return { path: pane.dataset.path, node: pane }

  // The background of a list or icon view is the folder being shown.
  if (el.content.contains(target) && activePath()) {
    return { path: activePath(), node: el.content }
  }
  return null
}

/** Find the item a row or icon cell was built from. */
function itemForNode(node) {
  const name = node.dataset.name
  if (!name) return null
  const pool = [...(activeColumn()?.items ?? []), ...state.selection]
  return pool.find((i) => i.name === name) ?? null
}

/** The paths being dragged, each with a name the transfer can report on. */
function dragPayload() {
  if (!dragState) return { paths: [], names: {} }
  const names = {}
  for (const item of dragState.items) {
    if (item.path) names[item.path] = item.name
  }
  return { paths: dragState.items.map((i) => i.path).filter(Boolean), names }
}

/**
 * Start a drag from a row or an icon cell.
 *
 * Dragging an item that is NOT part of the selection drags just that item, the way every
 * file manager behaves — otherwise picking up one file out of five would move all five.
 */
function onDragStart(event) {
  const node = event.target.closest?.('.row, .icon-cell')
  if (!node) return
  const item = itemForNode(node)
  if (!item?.path) {
    event.preventDefault()
    return
  }

  const items = isSelected(item.name) ? [...state.selection] : [item]
  dragState = { items, from: activePath() }

  // The payload is set even though we read our own state, because another application may
  // be the one receiving the drop.
  try {
    event.dataTransfer.setData('text/plain', items.map((i) => i.name).join('\n'))
    event.dataTransfer.effectAllowed = 'copyMove'
  } catch {
    // A browser that refuses custom data still drags; the in-app path does not need it.
  }

  for (const i of items) {
    const el = document.querySelector(`.row[data-name="${CSS.escape(i.name)}"]`)
    el?.classList.add('is-dragging')
  }
}

function onDragEnd() {
  dragState = null
  clearDropTargets()
  for (const node of document.querySelectorAll('.is-dragging')) node.classList.remove('is-dragging')
}

/** Allow a drop only where one makes sense, and show where it will land. */
function onDragOver(event) {
  const destination = dropDestinationAt(event.target)
  if (!destination) return

  // An item cannot be dropped into the folder it already lives in, and a folder cannot be
  // dropped into its own subtree. Refusing the highlight is the honest signal; the drop
  // itself refuses too, in case the pointer arrives without passing through here.
  if (dragState && dragState.items.some((i) => i.path === destination.path)) return

  event.preventDefault()
  event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move'
  markDropTarget(destination.node)
}

/** Handle the drop. */
async function onDrop(event) {
  const destination = dropDestinationAt(event.target)
  clearDropTargets()
  if (!destination) return
  event.preventDefault()

  const op = event.ctrlKey ? 'copy' : 'move'

  // A drag that began in this app: we know exactly what is in flight.
  if (dragState) {
    const { paths, names } = dragPayload()
    const items = [...dragState.items]
    dragState = null
    for (const node of document.querySelectorAll('.is-dragging')) node.classList.remove('is-dragging')
    if (paths.length === 0) return
    await runDrop({ op, paths, names, destination: destination.path, label: labelFor(items, op) })
    return
  }

  // A drag that arrived from Explorer or another app: the paths have to be resolved from
  // the dropped File objects, which only the preload side can do.
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length === 0) return
  const paths = []
  const names = {}
  for (const file of files) {
    const p = window.finder.pathForFile ? window.finder.pathForFile(file) : ''
    if (!p) continue
    paths.push(p)
    names[p] = file.name
  }
  if (paths.length === 0) return
  await runDrop({
    op,
    paths,
    names,
    destination: destination.path,
    label: `${paths.length} item${paths.length === 1 ? '' : 's'}`
  })
}

/** A short description of what is being moved, for the message afterwards. */
function labelFor(items, op) {
  const verb = op === 'copy' ? 'Copied' : 'Moved'
  if (items.length === 1) return `${verb} “${items[0].name}”`
  return `${verb} ${items.length} items`
}

/** Run the transfer and report what actually happened. */
async function runDrop({ op, paths, names, destination, label }) {
  const result = await window.finder.dropFiles({ op, paths, names, destination })
  if (result?.noop) {
    showToast('That item is already in that folder.')
    return
  }
  if (result?.ok) {
    showToast(`${label}.`)
  } else if (result?.moved > 0) {
    // A partial failure is a partial failure, and says which item went wrong.
    showToast(`${label.split(' ')[0]} ${result.moved} of ${result.total}. ${result.error}`)
  } else {
    showToast(result?.error || 'That did not work.')
  }
  if (result?.moved > 0) await refreshLive()
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const SVG = {
  folder:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 4.2c0-.7.6-1.2 1.2-1.2h3l1.3 1.5h6.1c.7 0 1.2.6 1.2 1.2v6.1c0 .7-.6 1.2-1.2 1.2H2.8c-.7 0-1.2-.6-1.2-1.2V4.2Z" fill="currentColor" opacity=".92"/></svg>',
  file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  home: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 14 7v7.2H2V7l6-5.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.2 14.2V9.4h3.6v4.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  drive: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="4" width="12.4" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="11.6" cy="8" r="1.1" fill="currentColor"/></svg>',
  removable:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="5.6" width="8" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.4 5.4V2.6h3.2v2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  network:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="3.4" cy="12.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12.6" cy="12.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.6 4.7 4.6 10.7M9.4 4.7l2 6M5.2 12.4h5.6" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>'
}

/** A distinct glyph per kind, so a glance tells you what a file is. */
const KIND_SVG = {
  image:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.6" cy="6.4" r="1.2" fill="currentColor"/><path d="M2.4 11.6 6 8.4l2.6 2.4 2.2-2 2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  video:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.4" width="9.4" height="9.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11.4 7.4 14.4 5.6v4.8l-3-1.8Z" fill="currentColor"/></svg>',
  audio:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.4 3.2 12.4 2v8.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="4.8" cy="11.6" r="1.9" fill="currentColor"/><circle cx="10.8" cy="10.4" r="1.9" fill="currentColor"/></svg>',
  pdf: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.2 10.6h5.4M5.2 12.4h3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  code: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.4 2.6 8 6 12.6M10 3.4 13.4 8 10 12.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  archive:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 2.4h2v3H7zM7 6.4h2v3H7z" fill="currentColor"/></svg>',
  spreadsheet:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3" width="12.4" height="10" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.8 6.6h12.4M6.6 3v10M1.8 10h12.4" stroke="currentColor" stroke-width="1.4"/></svg>',
  presentation:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 11v2.4M5.6 14h4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  document:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.4 9h5.2M5.4 11h5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  executable:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3" width="12.4" height="10" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.4 6.4 6.6 8l-2.2 1.6M8 10.4h3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  text: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.4 9.2h5.2M5.4 11.2h3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
}

function iconFor(item) {
  if (item.isDirectory) return SVG.folder
  return KIND_SVG[item.kind] || SVG.file
}

/**
 * Real file-type icons, from the operating system.
 *
 * Drawn in two passes on purpose. The listing paints immediately with the built-in vector
 * glyph, then this asks the shell for the true icon and swaps it in when it arrives. That
 * ordering is the whole design: `app.getFileIcon` is an async round trip, and making the
 * first paint wait for it would trade a fast folder for a pretty one. If the shell never
 * answers, the vector glyph stays and nothing is missing.
 *
 * Keyed by EXTENSION on this side too, and one lookup is shared between every element of
 * the same type, so a folder of 5,000 videos makes one call and does one re-render. A
 * dotfile like `.gitignore` and a bare `README` both go in the no-extension bucket, which
 * the shell resolves to the generic file icon.
 */
const iconCache = new Map()

/**
 * Fetch the icons for the types on screen, then repaint ONCE.
 *
 * The single repaint matters as much as the caching: swapping each glyph as its own
 * promise resolved would re-render the list once per file type and lose the user's scroll
 * position each time.
 */
let iconRequestToken = 0
async function loadIconsFor(items) {
  if (!window.finder?.fileIcon) return

  const wanted = new Map()
  for (const item of items) {
    const key = item.isDirectory ? '#folder' : (() => {
      const dot = item.name.lastIndexOf('.')
      return dot > 0 ? item.name.slice(dot).toLowerCase() : '#none'
    })()
    if (!iconCache.has(key) && !wanted.has(key)) wanted.set(key, item)
  }
  if (wanted.size === 0) return

  const token = ++iconRequestToken
  const answers = await Promise.allSettled(
    [...wanted.entries()].map(async ([key, item]) => {
      const path = item.path || (await window.finder.joinPath(activePath(), item.name))
      const result = await window.finder.fileIcon(path, Boolean(item.isDirectory))
      return [key, result?.icon || null]
    })
  )

  let gained = false
  for (const answer of answers) {
    if (answer.status !== 'fulfilled') continue
    const [key, icon] = answer.value
    // Cache the miss too, so a type the shell has no icon for is asked about once, not on
    // every re-render.
    iconCache.set(key, icon)
    if (icon) gained = true
  }

  // A stale answer must not repaint a folder the user has already left.
  if (token !== iconRequestToken || !gained) return
  paintIcons()
}

/** Swap each rendered glyph for its real icon, in place. Cheaper and calmer than a
 *  full re-render: no scroll jump, no selection loss. */
function paintIcons() {
  for (const row of el.content.querySelectorAll('.row, .icon-cell')) {
    const name = row.dataset.name
    if (!name) continue
    // `.glyph` in the list and column views, `.icon-art` in the icon view — the two
    // holders are named differently, and a wrong selector here would silently do nothing.
    const holder = row.querySelector('.glyph, .icon-art')
    if (!holder) continue
    const dot = name.lastIndexOf('.')
    const key = row.dataset.dir === '1' ? '#folder' : (dot > 0 ? name.slice(dot).toLowerCase() : '#none')
    const icon = iconCache.get(key)
    if (!icon) continue
    holder.innerHTML = `<img class="file-icon" src="${icon}" alt="" draggable="false">`
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function formatDate(value) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit'
  })
}

function formatKind(item) {
  if (item.isDirectory) return 'Folder'
  const kind = item.kind || 'other'
  // A bare 'other' is not a kind, it is the absence of one, so it reads as Document
  // with the extension as the specific part.
  const label = kind === 'other' ? 'Document' : kind[0].toUpperCase() + kind.slice(1)
  const extension = item.name.includes('.') ? item.name.split('.').pop().toUpperCase() : ''
  // 'Pdf (PDF)' is noise; only name the extension when it adds something.
  if (!extension || extension === label.toUpperCase()) return label
  // A file with no name before the dot ('.gitignore') is not a 'Document (GITIGNORE)'.
  if (item.name.startsWith('.')) return label
  return `${label} (${extension})`
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The folder that contains a path.
 *
 * Derived by the same rule the rest of the app uses, because slicing at the last
 * separator returns "C:" for "C:\Users\logo.png" — the drive root, not the folder.
 */
function folderOf(path) {
  if (!path) return null
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (cut < 0) return null
  // Keep a drive root's trailing separator (C:\) and drop a bare root's.
  if (cut === 2 && path[1] === ':') return path.slice(0, 3)
  if (cut === 0) return path.slice(0, 1)
  return path.slice(0, cut)
}

/** Case-insensitive, and stable so the order never flickers between renders. */
/**
 * Which items a folder shows, given the type filter and the name pattern.
 *
 * The two are independent: "only video" and "only V003" are different questions and are
 * often asked together.
 */
function applyFilter(items) {
  const needle = state.filter.trim().toLowerCase()
  const kinds = state.kindFilter
  const pattern = state.pattern.trim().toLowerCase()

  return items.filter((item) => {
    // A folder is never hidden by a TYPE filter: hiding folders makes a folder look
    // empty when it is not, and there is no way back down the tree.
    if (kinds.size > 0 && !item.isDirectory) {
      const kind = item.kind || 'other'
      if (!kinds.has(kind)) return false
    }

    if (needle && !item.name.toLowerCase().includes(needle)) return false

    // The pattern matches anywhere in the name, so "V003" finds every version's files
    // and "_VO" finds the voiceover takes without needing a wildcard.
    if (pattern && !item.name.toLowerCase().includes(pattern)) return false

    return true
  })
}

/** Is any filter narrowing this folder? */
function isFiltering() {
  return state.kindFilter.size > 0 || state.pattern.trim() !== ''
}

/** Folders first, then names — Finder's default ordering. */
function sortItems(items) {
  return items.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/**
 * The kinds a folder actually contains, with a count each, ordered the way a person
 * scans a folder: folders, then images, video, audio, documents, other.
 *
 * Only kinds PRESENT are offered, because a filter menu that lists file types this
 * folder does not contain is a menu of dead ends.
 */
const KIND_ORDER = ['folder', 'image', 'video', 'audio', 'pdf', 'text', 'code', 'other']

function kindLabel(kind) {
  if (kind === 'folder') return 'Folders'
  if (kind === 'other') return 'Other'
  return `${kind[0].toUpperCase()}${kind.slice(1)}`
}

function availableKinds(items) {
  const counts = new Map()
  for (const item of items) {
    const kind = item.isDirectory ? 'folder' : item.kind || 'other'
    counts.set(kind, (counts.get(kind) || 0) + 1)
  }
  return KIND_ORDER.filter((k) => counts.has(k)).map((k) => ({ kind: k, count: counts.get(k) }))
}

/**
 * Apply the folder's sort order.
 *
 * Folders always stay above files whatever the sort: mixing a folder in among the files
 * by date is how a file manager stops feeling like one. The sort then applies WITHIN
 * each group, and every comparison falls back to name so the order is total and never
 * flickers between renders.
 */
function applySort(items) {
  const { key, ascending } = state.sort
  const dir = ascending ? 1 : -1

  return items.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1

    let result = 0
    if (key === 'kind') {
      const ka = a.isDirectory ? 'folder' : a.kind || 'other'
      const kb = b.isDirectory ? 'folder' : b.kind || 'other'
      result = KIND_ORDER.indexOf(ka) - KIND_ORDER.indexOf(kb)
    } else if (key === 'size') {
      // An unknown size sorts below a known one rather than being treated as zero.
      const sa = typeof a.size === 'number' ? a.size : null
      const sb = typeof b.size === 'number' ? b.size : null
      if (sa === null && sb === null) result = 0
      else if (sa === null) result = 1
      else if (sb === null) result = -1
      else result = sa - sb
    } else if (key === 'modified') {
      result = (a.modifiedAt || 0) - (b.modifiedAt || 0)
    } else {
      result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (result !== 0) return result * dir
    // Ties break by name, ascending, so the order is deterministic.
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/** The one place a folder's items are filtered and sorted for display. */
/**
 * The items a view should show: the filter, the pattern, and now hidden files.
 *
 * `isHidden` has been computed by the reader for every item since the beginning — the
 * attribute bits come back with the bulk enumeration whether or not anyone looks — and
 * nothing read it. A hidden file that is never shown is the same as one that does not
 * exist, so the switcher is the last piece.
 *
 * Folders are exempt from the hidden filter, exactly as Explorer and Finder treat them:
 * hiding the folder the user is standing in is how a file manager loses them. (The filter
 * and pattern rules already keep folders visible for the same reason.)
 */
function visibleByHidden(items) {
  if (state.showHidden) return items
  return items.filter((item) => !item.isHidden)
}

function presentItems(items) {
  return applySort(applyFilter(visibleByHidden(items)))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * What to call a column when it is read out. The path is the honest label: "Videos" alone
 * is ambiguous when three columns are open.
 */
function columnLabel(column) {
  if (column.error) return `Could not open ${column.path || 'the folder'}`
  return `${baseName(column.path) || column.path || 'Folder'}, ${pluralize(column.items.length, 'item')}`
}

/**
 * Say what just happened, once per change.
 *
 * Deliberately a short sentence and not the status bar verbatim: a screen reader reading
 * "12 items · 3 folders" after every keystroke is unusable. This fires from render(),
 * which runs on every state change, so the guard against repeating the same sentence is
 * what keeps it from being noise.
 */
let lastAnnouncement = ''
function announceState() {
  if (state.searchText) return
  const column = activeColumn()
  if (!column) return
  if (column.error) {
    sayError(column.error)
    lastAnnouncement = ''
    return
  }
  const shown = presentItems(column.items)
  const hidden = column.items.length - shown.length
  let message
  if (state.selected) {
    message = `${state.selected.name}, ${state.selected.isDirectory ? 'folder' : 'file'}`
    const position = shown.findIndex((i) => i.name === state.selected.name)
    if (position >= 0) message += `, ${position + 1} of ${shown.length}`
  } else {
    message = `${baseName(column.path) || 'Folder'}, ${pluralize(shown.length, 'item')}`
    if (hidden > 0) message += `, ${hidden} hidden by the filter`
  }
  if (message === lastAnnouncement) return
  lastAnnouncement = message
  announce(message)
}

function render() {
  if (state.searchText) renderSearchResults()
  else if (state.view === 'column') renderColumns()
  else if (state.view === 'list') renderList()
  else renderIcons()
  renderStatus()
  announceState()
  renderNavButtons()
  renderBreadcrumb()
  renderPreview()
  renderStepControls()
  renderSearchBar()
  renderSortLabel()
  renderFilterLabel()
  renderPatternBar()
  renderClipboardState()
  syncWatchers()
  // Not awaited: the listing is already on screen with its vector glyphs, and the real
  // icons arrive when the shell answers.
  loadIconsFor(state.columns.length ? presentItems(state.columns[state.columns.length - 1].items) : []).catch(
    () => {}
  )
}

function renderNavButtons() {
  el.back.disabled = backStack.length === 0
  el.forward.disabled = forwardStack.length === 0
  const path = activePath()
  el.up.disabled = !path || !canGoUp(path)
  el.title.textContent = state.columns.length ? baseName(path) || path : 'Finder for Windows'
  // The status-bar path is owned by renderStatus, which points it at the SELECTION.
  // Setting it here too made the two disagree, and this one ran last.
}

function baseName(path) {
  if (!path) return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  const last = parts[parts.length - 1]
  // "C:\" trims to "C:" — show the drive instead of an empty title.
  return last === '' || /^[A-Za-z]:$/.test(last) ? trimmed : last
}

/**
 * Can this path go up? A drive root cannot. The main process owns the real rule;
 * this only decides whether the button is disabled, so it is conservative.
 */
function canGoUp(path) {
  if (/^[A-Za-z]:\\?$/.test(path)) return false
  if (path === '/') return false
  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?$/.test(path)) return false
  return true
}

function renderStatus() {
  const column = activeColumn()
  if (!column) {
    el.statusCount.textContent = ''
    return
  }
  const shown = presentItems(column.items)
  const folders = shown.filter((i) => i.isDirectory).length
  const parts = [pluralize(shown.length, 'item'), pluralize(folders, 'folder')]
  // Say what is being hidden, and from how many. A filtered folder that just shows a
  // smaller number is a folder that looks like it lost files.
  const hidden = column.items.length - shown.length
  if (hidden > 0) parts.push(`filtered from ${column.items.length}`)
  if (state.selected && !state.selected.isDirectory && typeof state.selected.size === 'number') {
    parts.push(`selected: ${formatSize(state.selected.size)}`)
  }
  el.statusCount.textContent = parts.join(' · ')

  // The path readout follows the SELECTION, not just the folder: when a file is picked
  // the thing people want to copy is that file's path, not the folder they are standing
  // in. Clicking it copies — see copyPath.
  const selectedPath = state.selected?.path
  el.statusPath.textContent = selectedPath || activePath() || ''
  el.statusPath.title = selectedPath ? 'Click to copy this path' : 'Click to copy this path'
  el.statusPath.dataset.copy = el.statusPath.textContent
  el.statusPath.classList.toggle('is-copyable', Boolean(el.statusPath.textContent))
}

/** One row inside a column or a list. */
function buildRow(item, { showMeta = false } = {}) {
  const row = document.createElement('div')
  row.className = 'row' + (item.isDirectory ? ' is-dir' : '')
  row.dataset.name = item.name
  row.dataset.dir = item.isDirectory ? '1' : ''
  row.dataset.kind = item.kind || ''
  // Draggable so a file can be picked up and dropped on a folder. The path is carried on
  // the item, not looked up later, because dragstart is synchronous and cannot await IPC.
  row.draggable = true
  row.setAttribute('role', 'option')
  row.setAttribute('aria-selected', 'false')
  // Tab must be able to REACH the files. Before this the file list was unreachable by
  // keyboard entirely: every command had a shortcut, but a keyboard-only user could not
  // get to the list to use one, so the shortcuts were theoretical.
  row.tabIndex = -1

  const glyph = document.createElement('span')
  glyph.className = 'glyph'
  glyph.innerHTML = iconFor(item)

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = item.name
  name.title = item.name

  row.append(glyph, name)

  if (showMeta) {
    const kind = document.createElement('span')
    kind.className = 'col-kind'
    kind.textContent = formatKind(item)

    const size = document.createElement('span')
    size.className = 'col-size'
    size.textContent = item.isDirectory ? '--' : formatSize(item.size)

    const date = document.createElement('span')
    date.className = 'col-date'
    date.textContent = formatDate(item.modifiedAt)

    row.append(kind, size, date)
  }

  if (item.isCloudPlaceholder) {
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = 'cloud'
    badge.title = 'Stored online; opening it will download it'
    row.append(badge)
  }
  if (item.metadataUnavailable) {
    const badge = document.createElement('span')
    badge.className = 'badge badge-warn'
    badge.textContent = 'unavailable'
    badge.title = 'This location could not be read; details are missing'
    row.append(badge)
  }

  return row
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Results are a flat list of files from anywhere in the index, so they get their own view. */
function renderSearchResults() {
  el.content.className = 'content content-list content-results'
  el.content.replaceChildren()

  if (state.searchBusy) {
    const busy = document.createElement('p')
    busy.className = 'hint'
    busy.textContent = 'Searching…'
    el.content.append(busy)
    return
  }

  if (state.searchError) {
    // A search that could not RUN is not a search that found nothing. Saying "nothing
    // matches" here would be a lie about the user's files.
    const failed = document.createElement('p')
    failed.className = 'error'
    failed.setAttribute('role', 'alert')
    failed.textContent = `The search could not be run. ${state.searchError}`
    el.content.append(failed)
    return
  }

  if (state.searchResults.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = state.index.known
      ? `Nothing matches “${state.searchText}”.`
      : 'Nothing matches yet — the index has not been built. Use “Build Index”.'
    el.content.append(empty)
    return
  }

  const header = document.createElement('div')
  header.className = 'list-header'
  // The leading empty cell is the icon gutter, matching the row grid. Without it "Name"
  // sat left of the names it labels.
  header.innerHTML =
    '<span class="col-icon" aria-hidden="true"></span><span class="col-name">Name</span><span class="col-kind">Matched</span><span class="col-size">Size</span><span class="col-date">Date Modified</span>'
  el.content.append(header)

  for (const item of state.searchResults) {
    const row = document.createElement('div')
    row.className = 'row row-result'
    row.dataset.name = item.name
    row.dataset.path = item.path
    row.dataset.kind = item.kind || ''
    row.dataset.dir = ''
    row.tabIndex = 0

    // The enclosing folder, because a search result with no location is not actionable.
    const folder = item.path.slice(0, Math.max(0, item.path.length - item.name.length - 1))

    const art = document.createElement('span')
    art.className = 'row-icon'
    art.innerHTML = iconFor(item)

    const name = document.createElement('span')
    name.className = 'col-name'
    name.textContent = item.name

    const where = document.createElement('span')
    where.className = 'row-where'
    where.textContent = folder
    where.title = item.path

    const matched = document.createElement('span')
    matched.className = 'col-kind'
    matched.textContent = item.matched === 'name' ? 'Name' : 'Contents'

    const size = document.createElement('span')
    size.className = 'col-size'
    size.textContent = item.size == null ? '—' : formatSize(item.size)

    const date = document.createElement('span')
    date.className = 'col-date'
    date.textContent = formatDate(item.modifiedAt)

    name.append(where)
    row.append(art, name, matched, size, date)

    if (state.selected?.path === item.path) {
      row.classList.add('is-selected')
      row.setAttribute('aria-selected', 'true')
    }
    el.content.append(row)
  }
}

/** The bar above the results: what was searched, and the way back. */
function renderSearchBar() {
  const showing = state.searchText !== ''
  el.searchbar.hidden = !showing
  el.scopeWrap.hidden = !showing

  if (!showing) return
  const where = state.searchScope === 'folder' ? `in ${baseName(activePath()) || 'this folder'}` : 'everywhere'
  const count = state.searchTotal
  el.searchSummary.textContent = state.searchBusy
    ? `Searching ${where}…`
    : `${count} ${count === 1 ? 'result' : 'results'} for “${state.searchText}” ${where}`
}

/** Run the search and show the results. Debounced by the caller. */
async function runSearch() {
  const text = el.search.value.trim()
  state.searchText = text
  state.searchScope = el.scope.value

  if (text === '') {
    state.searchResults = []
    state.searchTotal = 0
    state.selected = null
  state.selection = []
  state.anchorName = null
    render()
    return
  }

  state.searchBusy = true
  render()

  try {
    const result = await window.finder.search({
      text,
      scope: state.searchScope,
      folder: state.searchScope === 'folder' ? activePath() : null
    })
    state.searchResults = result.ok ? result.results : []
    state.searchTotal = result.ok ? result.total : 0
    state.searchError = result.ok ? null : result.error
  } catch (error) {
    state.searchResults = []
    state.searchTotal = 0
    state.searchError = String(error)
  } finally {
    state.searchBusy = false
    render()
  }
}

/** Leave the results and go back to the folder listing. */
function exitSearch() {
  el.search.value = ''
  el.searchClear.hidden = true
  state.searchText = ''
  state.searchResults = []
  state.searchTotal = 0
  state.selected = null
  state.selection = []
  state.anchorName = null
  render()
}

// ---------------------------------------------------------------------------
// Index coverage
// ---------------------------------------------------------------------------

/** Always say what the index covers: a search that silently knows part of the disk is a trap. */
function renderIndexBar() {
  const index = state.index

  if (index.running) {
    el.indexbar.hidden = false
    el.indexbar.classList.add('is-running')
    el.indexText.textContent =
      `Indexing… ${index.files.toLocaleString()} files in ${index.folders.toLocaleString()} folders` +
      (index.current ? ` · ${index.current}` : '')
    el.indexAction.textContent = 'Stop'
    el.indexDismiss.hidden = true
    return
  }

  el.indexbar.classList.remove('is-running')
  el.indexAction.textContent = 'Build Index'
  el.indexDismiss.hidden = false

  if (!index.known) {
    el.indexbar.hidden = false
    el.indexText.textContent = 'Search inside files needs an index. Building it reads file names first, then contents.'
    return
  }

  if (state.indexDismissed) {
    el.indexbar.hidden = true
    return
  }

  el.indexbar.hidden = false
  const minutes = Math.max(1, Math.round(index.elapsedMs / 60000))
  el.indexText.textContent =
    `Index covers ${index.files.toLocaleString()} files · ${index.contentRead?.toLocaleString() ?? 0} with contents read · built in ${minutes} min`
}

async function refreshIndexStatus() {
  try {
    const status = await window.finder.indexStatus()
    state.index = {
      ...state.index,
      known: !!status.stats,
      running: !!status.running,
      files: status.stats?.files ?? status.files ?? 0,
      folders: status.stats?.folders ?? status.folders ?? 0,
      contentRead: status.stats?.contentRead ?? 0,
      elapsedMs: status.stats?.elapsedMs ?? 0
    }
  } catch {
    /* the banner is advisory; a failure here must not stop the app */
  }
  renderIndexBar()
}

async function startIndexing() {
  state.indexDismissed = false
  state.index.running = true
  renderIndexBar()
  try {
    await window.finder.buildIndex()
  } catch {
    /* the scan reports its own failures through progress */
  }
  await refreshIndexStatus()
  if (state.searchText) await runSearch()
}

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

function renderColumns() {
  el.content.className = 'content content-columns'
  el.content.replaceChildren()

  for (let index = 0; index < state.columns.length; index += 1) {
    const column = state.columns[index]
    const pane = document.createElement('div')
    pane.className = 'column'
    pane.dataset.index = String(index)
    pane.dataset.path = column.path || ''
    // A listbox, so the files are a thing a screen reader can enter and read. Only one
    // column is tabbable (the active one): 40 files must not mean 40 Tab presses to get
    // past the list, which is the standard listbox pattern and why rows are tabIndex -1.
    pane.setAttribute('role', 'listbox')
    pane.setAttribute('aria-label', columnLabel(column))
    // Only the ACTIVE column is a tab stop. Testing `column.selectedName` was wrong: in
    // column view several columns hold a selection at once, so all three became tab stops
    // and Tab walked through them. The active column is the one the arrows act on.
    if (column === activeColumn()) pane.tabIndex = 0

    const items = presentItems(column.items)

    if (items.length === 0) {
      // Only claim the folder is empty when it could actually be read. Under a
      // permission error the banner above already says it could not be, and printing
      // "Empty" underneath it says the opposite.
      if (!column.error) {
        const empty = document.createElement('p')
        empty.className = 'hint'
        empty.textContent = state.filter.trim() ? 'No matches here.' : 'Empty'
        pane.append(empty)
      }
    } else {
      for (const item of items) {
        const row = buildRow(item)
        if (isSelected(item.name)) {
          row.classList.add('is-selected')
          row.setAttribute('aria-selected', 'true')
        }
        pane.append(row)
      }
    }

    el.content.append(pane)
  }

  // Keep the front column in view — this is what makes column view feel like Finder.
  requestAnimationFrame(() => {
    el.content.scrollLeft = el.content.scrollWidth
  })
}

function renderList() {
  el.content.className = 'content content-list'
  el.content.replaceChildren()

  const column = activeColumn()
  if (!column) return

  const header = document.createElement('div')
  header.className = 'list-header'
  // The leading empty cell is the icon gutter, matching the row grid. Without it the four
  // sort buttons were laid into cells 1-4 of a five-column grid, so "Name" sat in the icon
  // gutter and every header label stood one column to the left of its own data.
  const gutter = document.createElement('span')
  gutter.className = 'col-icon'
  gutter.setAttribute('aria-hidden', 'true')
  header.append(gutter)
  // Each header sorts by its own column. The active one carries the arrow, so the header
  // row states the order instead of the user having to open a menu to find out.
  const cols = [
    { key: 'name', label: 'Name', cls: 'col-name' },
    { key: 'kind', label: 'Kind', cls: 'col-kind' },
    { key: 'size', label: 'Size', cls: 'col-size' },
    { key: 'modified', label: 'Date Modified', cls: 'col-date' }
  ]
  for (const col of cols) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = `${col.cls} list-sort`
    const active = state.sort.key === col.key
    cell.textContent = active ? `${col.label} ${state.sort.ascending ? '↑' : '↓'}` : col.label
    cell.setAttribute('aria-sort', active ? (state.sort.ascending ? 'ascending' : 'descending') : 'none')
    cell.title = `Sort by ${col.label}`
    cell.addEventListener('click', () => {
      if (state.sort.key === col.key) state.sort.ascending = !state.sort.ascending
      else {
        state.sort.key = col.key
        state.sort.ascending = true
      }
      render()
    })
    header.append(cell)
  }
  el.content.append(header)

  const items = presentItems(column.items)
  if (items.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = state.filter.trim() ? 'No matches in this folder.' : 'This folder is empty.'
    el.content.append(empty)
    return
  }

  for (const item of items) {
    const row = buildRow(item, { showMeta: true })
    if (isSelected(item.name)) {
      row.classList.add('is-selected')
      row.setAttribute('aria-selected', 'true')
    }
    el.content.append(row)
  }
}

function renderIcons() {
  el.content.className = 'content content-icons'
  el.content.replaceChildren()

  const column = activeColumn()
  if (!column) return

  const items = presentItems(column.items)
  if (items.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = state.filter.trim() ? 'No matches in this folder.' : 'This folder is empty.'
    el.content.append(empty)
    return
  }

  const grid = document.createElement('div')
  grid.className = 'icon-grid'

  for (const item of items) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'icon-cell' + (item.isDirectory ? ' is-dir' : '')
    cell.dataset.name = item.name
    cell.dataset.dir = item.isDirectory ? '1' : ''
    cell.dataset.kind = item.kind || ''
    cell.draggable = true
    if (isSelected(item.name)) cell.classList.add('is-selected')

    const art = document.createElement('span')
    art.className = 'icon-art' + (item.kind === 'image' ? ' is-picture' : '')
    art.innerHTML = iconFor(item)

    const label = document.createElement('span')
    label.className = 'icon-label'
    label.textContent = item.name
    label.title = item.name

    cell.append(art, label)
    grid.append(cell)
  }

  el.content.append(grid)
}

// ---------------------------------------------------------------------------
// Preview pane and Quick Look
// ---------------------------------------------------------------------------

async function renderBreadcrumb() {
  const path = activePath()
  el.breadcrumb.replaceChildren()
  if (!path) return

  const parts = await window.finder.pathSegments(path)
  let running = ''

  parts.forEach((part, index) => {
    if (index > 0) {
      const separator = document.createElement('span')
      separator.className = 'crumb-sep'
      separator.textContent = '›'
      el.breadcrumb.append(separator)
    }

    // Rebuild the cumulative path so every crumb is clickable.
    if (index === 0) running = part
    else running = running.endsWith('\\') || running.endsWith('/') ? running + part : `${running}\\${part}`

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'crumb'
    button.textContent = part
    button.dataset.path = running
    el.breadcrumb.append(button)
  })
}

async function renderPreview() {
  if (!state.previewOpen || !state.selected) {
    el.previewBody.replaceChildren()
    el.previewName.textContent = ''
    el.previewName.title = ''
    el.previewMeta.textContent = ''
    return
  }

  const item = state.selected
  const path = item.path || (await window.finder.joinPath(activePath(), item.name))

  el.previewName.textContent = item.name
  // The preview pane is narrow and a shot name like scene-01-take-01_VO.mp4 does
  // not fit, so the full name stays reachable on hover.
  el.previewName.title = item.name

  // A folder has no contents to render, but a blank pane is not an answer: show what is
  // inside it and how much. This used to leave the pane empty entirely.
  if (item.isDirectory) {
    const token = ++previewToken
    el.previewMeta.textContent = 'Folder'
    const listing = await window.finder.listDirectory(path)
    if (token !== previewToken) return
    const children = listing.ok ? listing.items : []
    el.previewBody.replaceChildren()
    const stage = document.createElement('div')
    stage.className = 'preview-stage'
    if (!listing.ok) {
      stage.append(note(listing.error))
    } else {
      const list = document.createElement('div')
      list.className = 'quicklook-list'
      for (const child of children.slice(0, 40)) {
        const line = document.createElement('div')
        line.className = 'quicklook-line'
        const glyph = document.createElement('span')
        glyph.className = 'glyph'
        glyph.innerHTML = iconFor(child)
        const label = document.createElement('span')
        label.className = 'name'
        label.textContent = child.name
        line.append(glyph, label)
        list.append(line)
      }
      stage.append(list)
      if (children.length > 40) stage.append(note(`and ${children.length - 40} more`))
    }
    el.previewBody.append(stage)

    const info = buildInfoBlock(item, {
      childCount: children.length,
      folderCount: children.filter((c) => c.isDirectory).length
    })
    if (info) el.previewBody.append(info)
    return
  }

  const token = ++previewToken
  el.previewMeta.textContent = `${formatKind(item)}${
    typeof item.size === 'number' ? ` · ${formatSize(item.size)}` : ''
  }`

  const preview = await window.finder.getPreview(path, item.name)
  if (token !== previewToken) return // the selection moved on while we were reading

  fillPane(el.previewBody, preview, path, item.name, item)
}

/**
 * The details block under the preview: what the file is, how big, and when.
 *
 * A preview with no facts around it answers "what is it" but not "which one is it" —
 * the question people actually have when two files look alike. Values the app does not
 * know are omitted rather than shown as a dash: an empty row teaches nothing.
 *
 * @param {object} item the selected item (size/kind/dates), when the caller has it
 */
function buildInfoBlock(item = {}, preview = {}) {
  const rows = []

  const add = (label, value, { copy = false } = {}) => {
    if (value === null || value === undefined || value === '') return
    rows.push([label, String(value), copy])
  }

  // Pixel dimensions come from the rendered image itself (see measureImage), so they
  // are appended by the caller once the element has loaded.
  add('Kind', formatKind(item))
  if (typeof item.size === 'number') add('Size', formatSize(item.size))
  // A folder has no meaningful byte size, so it gets a count of what is inside instead
  // of "Unknown" — which is what it used to say.
  if (item.size === null && !item.isDirectory) add('Size', 'Unknown')
  if (item.isDirectory && typeof preview.childCount === 'number') {
    add('Contains', `${pluralize(preview.childCount, 'item')} · ${pluralize(preview.folderCount ?? 0, 'folder')}`)
  }
  // The folder is derived from the path, not by slicing off the last segment here: a
  // naive slice turns C:\Users\logo.png into "C:".
  add('Where', folderOf(item.path), { copy: true })
  // The full path, spelled out and copyable: this is the row the owner asked for, and
  // hiding it behind the folder row would make the obvious thing hard to find.
  add('Path', item.path, { copy: true })
  add('Created', formatDate(item.createdAt))
  add('Modified', formatDate(item.modifiedAt))
  if (preview.truncated) add('Shown', 'First part of the file only')

  if (rows.length === 0) return null

  const block = document.createElement('dl')
  block.className = 'info-block'
  for (const [label, value, copy] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    dd.title = value
    // A full path is too long to read in a narrow pane, and the moment you want it is
    // the moment you want to paste it somewhere — so it is one click, not a selection.
    if (copy) {
      dd.classList.add('is-copyable')
      dd.title = `${value}\n\nClick to copy`
      dd.addEventListener('click', () => copyPath(value, { what: label }))
    }
    block.append(dt, dd)
  }
  return block
}

/**
 * Append a Dimensions row to the info block.
 *
 * The image is not decoded when the block is built, so the row is added later. It must
 * be appended as a PAIR after the last row, not inserted after a bare `dt`: inserting
 * `dt` then `dd` after the Kind label splits Kind from its own value and shifts every
 * cell below it by one.
 */
function appendDimensionRow(block, text) {
  if (!block || block.querySelector('[data-dimensions]')) return
  const dt = document.createElement('dt')
  dt.textContent = 'Dimensions'
  dt.dataset.dimensions = '1'
  const dd = document.createElement('dd')
  dd.textContent = text
  block.append(dt, dd)
}

function measureImage(img, block) {
  const apply = () => {
    if (!block || !img.naturalWidth) return
    appendDimensionRow(block, `${img.naturalWidth} × ${img.naturalHeight}`)
  }
  if (img.complete && img.naturalWidth) apply()
  else img.addEventListener('load', apply, { once: true })
}

/**
 * Render one preview payload into a body element.
 *
 * The preview itself goes into a `.preview-stage` and the facts go into an
 * `.info-block` BELOW it — the owner asked for exactly this, and it is the right order:
 * you look at the thing first, then read what it is.
 */
function fillPane(body, preview, path, name, item = {}) {
  body.replaceChildren()

  if (!preview.ok) {
    body.append(note('Could not preview this file.'))
    return
  }

  const fileUrl = `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`
  const stage = document.createElement('div')
  stage.className = 'preview-stage'
  body.append(stage)

  const info = buildInfoBlock(item, preview)
  const finish = () => {
    if (info) body.append(info)
  }

  switch (preview.mode) {
    case 'image': {
      const image = document.createElement('img')
      image.src = fileUrl
      image.alt = name
      image.className = 'preview-image'
      image.addEventListener('error', () => {
        stage.replaceChildren(note('This image could not be displayed.'))
      })
      if (info) measureImage(image, info)
      stage.append(image)
      finish()
      return
    }
    case 'video': {
      const video = document.createElement('video')
      video.src = fileUrl
      video.controls = true
      video.className = 'preview-video'
      // Video knows its own pixel size too, once the metadata arrives.
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (!info || !video.videoWidth) return
          appendDimensionRow(info, `${video.videoWidth} × ${video.videoHeight}`)
        },
        { once: true }
      )
      stage.append(video)
      finish()
      return
    }
    case 'audio': {
      const audio = document.createElement('audio')
      audio.src = fileUrl
      audio.controls = true
      audio.className = 'preview-audio'
      stage.append(audio)
      finish()
      return
    }
    case 'pdf': {
      const frame = document.createElement('iframe')
      frame.src = fileUrl
      frame.className = 'preview-pdf'
      frame.title = name
      stage.append(frame)
      finish()
      return
    }
    case 'text': {
      const pre = document.createElement('pre')
      pre.className = 'preview-text'
      pre.textContent = preview.text
      stage.append(pre)
      if (preview.truncated) stage.append(note('Showing the beginning of this file.'))
      finish()
      return
    }
    default:
      stage.append(note(preview.note || 'No preview for this file type.'))
      finish()
  }
}

function note(text) {
  const p = document.createElement('p')
  p.className = 'hint'
  p.textContent = text
  return p
}

async function openQuickLook() {
  const item = state.selected
  if (!item) return

  state.quickLookOpen = true
  el.quicklook.hidden = false
  el.quicklookName.textContent = item.name
  el.quicklookBody.replaceChildren()
  renderQuickLookSteps()

  if (item.isDirectory) {
    // Space on a folder tells you what is inside it, which is genuinely useful.
    const path = item.path || (await window.finder.joinPath(activePath(), item.name))
    const result = await window.finder.listDirectory(path)
    el.quicklookMeta.textContent = 'Folder'
    if (!result.ok) {
      el.quicklookBody.append(note(result.error))
      return
    }
    const summary = document.createElement('p')
    summary.className = 'quicklook-summary'
    summary.textContent = `${pluralize(result.items.length, 'item')} · ${pluralize(
      result.items.filter((i) => i.isDirectory).length,
      'folder'
    )}`
    el.quicklookBody.append(summary)

    const list = document.createElement('div')
    list.className = 'quicklook-list'
    for (const child of result.items.slice(0, 200)) {
      const line = document.createElement('div')
      line.className = 'quicklook-line'
      const glyph = document.createElement('span')
      glyph.className = 'glyph'
      glyph.innerHTML = iconFor(child)
      const label = document.createElement('span')
      label.className = 'name'
      label.textContent = child.name
      line.append(glyph, label)
      list.append(line)
    }
    el.quicklookBody.append(list)
    return
  }

  const path = item.path || (await window.finder.joinPath(activePath(), item.name))
  const preview = await window.finder.getPreview(path, item.name)
  el.quicklookMeta.textContent = `${formatKind(item)}${
    typeof item.size === 'number' ? ` · ${formatSize(item.size)}` : ''
  }`
  fillPane(el.quicklookBody, preview, path, item.name, item)
}

function closeQuickLook() {
  state.quickLookOpen = false
  el.quicklook.hidden = true
  el.quicklookBody.replaceChildren()
}

/**
 * The arrows in Quick Look, and the counter beside them.
 *
 * Unlike the preview pane's arrows, these walk EVERY file, not only media: Quick Look is
 * the "look at this" view, so the right arrow should always move to the next thing rather
 * than stopping dead on a text file. That is also what makes the counter meaningful —
 * "4 of 12" is a fact about the folder, not about its videos.
 *
 * Hidden for a folder, which has nothing to step through, and when the folder holds a
 * single file, where a position of "1 of 1" would be noise.
 */
function renderQuickLookSteps() {
  const column = activeColumn()
  const pool = column ? presentItems(column.items).filter((item) => !item.isDirectory) : []
  const index = state.selected ? pool.findIndex((item) => item.name === state.selected.name) : -1

  const show = pool.length > 1 && index !== -1
  el.quicklookSteps.hidden = !show
  if (!show) return

  el.quicklookCount.textContent = `${index + 1} of ${pool.length}`
  el.quicklookPrev.disabled = index <= 0
  el.quicklookNext.disabled = index >= pool.length - 1
  el.quicklookPrev.title = el.quicklookPrev.disabled ? 'This is the first file' : 'Previous file (←)'
  el.quicklookNext.title = el.quicklookNext.disabled ? 'This is the last file' : 'Next file (→)'
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

async function renderSidebar() {
  // A sidebar that cannot be read must not take the window down with it: the user
  // still needs navigation. Anything unexpected renders as an empty sidebar.
  let sections = []
  try {
    const sidebar = await window.finder.getSidebar()
    if (Array.isArray(sidebar?.sections)) sections = sidebar.sections
  } catch {
    sections = []
  }

  el.sidebar.replaceChildren()

  for (const section of sections) {
    if (!Array.isArray(section?.items) || section.items.length === 0) continue // no dead rows

    const heading = document.createElement('h2')
    heading.className = 'sidebar-heading'
    heading.textContent = section.title
    el.sidebar.append(heading)

    const list = document.createElement('ul')
    list.className = 'sidebar-list'

    for (const item of section.items) {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sidebar-item'
      button.dataset.path = item.path
      if (state.activeSidebar === item.path) button.classList.add('is-active')

      const glyph = document.createElement('span')
      glyph.className = 'glyph'
      glyph.innerHTML = SVG[item.icon] || SVG.folder

      const label = document.createElement('span')
      label.className = 'sidebar-label'
      label.textContent = item.label

      button.append(glyph, label)
      li.append(button)
      list.append(li)
    }

    el.sidebar.append(list)
  }

  renderTagSection()
}

/**
 * The Tags section of the sidebar.
 *
 * Tags have existed in the app since the tag store was built, but with no way to see or
 * apply one they were invisible — built and unreachable. This is the surface.
 *
 * The section is HONEST about scope: these tags live in this app and nowhere else, so
 * the heading says so rather than letting a user tag a file and expect Windows to show
 * it. A tag with no files is not listed; an empty section says how to make one.
 */
async function renderTagSection() {
  let byTag = {}
  try {
    byTag = (await window.finder.listTags()) || {}
  } catch {
    byTag = {}
  }
  state.tags = byTag

  const names = Object.keys(byTag).filter((n) => (byTag[n] || []).length > 0)

  const heading = document.createElement('h2')
  heading.className = 'sidebar-heading'
  heading.textContent = 'Tags'
  el.sidebar.append(heading)

  const note = document.createElement('p')
  note.className = 'sidebar-note'
  note.textContent = 'Kept by this app only'
  note.title = 'These tags live inside Finder for Windows. Windows itself will not show them.'
  el.sidebar.append(note)

  const list = document.createElement('ul')
  list.className = 'sidebar-list'

  if (names.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'sidebar-empty'
    // Say how to make one, so the empty state is a next step rather than a dead end.
    empty.textContent = 'Right-click a file to add one.'
    list.append(empty)
  }

  for (const name of names) {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sidebar-item tag-item'
    button.dataset.tag = name
    if (state.activeTag === name) button.classList.add('is-active')

    const dot = document.createElement('span')
    dot.className = `tag-dot tag-${TAG_COLORS[name] || 'gray'}`

    const label = document.createElement('span')
    label.className = 'sidebar-label'
    label.textContent = name

    const count = document.createElement('span')
    count.className = 'tag-count'
    count.textContent = String(byTag[name].length)

    button.append(dot, label, count)
    button.addEventListener('click', () => showTag(name))
    li.append(button)
    list.append(li)
  }

  el.sidebar.append(list)
}

/** A stable color per tag name, so the same tag looks the same everywhere. */
const TAG_COLORS = {
  Red: 'red', Orange: 'orange', Yellow: 'yellow', Green: 'green',
  Blue: 'blue', Purple: 'purple', Gray: 'gray'
}

/**
 * Show the files carrying a tag.
 *
 * Implemented as a search rather than a second view, so there is ONE list-rendering path
 * in the app and the tag view cannot drift from the folder view.
 */
async function showTag(name) {
  const turningOff = state.activeTag === name
  state.activeTag = turningOff ? null : name

  if (turningOff) {
    exitSearch()
    renderSidebar()
    return
  }

  const paths = new Set(state.tags?.[name] || [])
  // The results must be real items, not bare paths: the list renders name, kind and
  // size, and a row missing those is a row the user cannot act on.
  const items = []
  for (const path of paths) {
    const item = await describePath(path)
    if (item) items.push(item)
  }

  state.searchText = `tag:${name}`
  state.searchResults = items
  state.searchTotal = items.length
  state.searchError = null
  state.searchBusy = false
  render()
  renderSidebar()
}

/** Read the facts about one path, so a result row has a name, a kind and a size. */
async function describePath(path) {
  try {
    const parent = await window.finder.parentPath(path)
    const name = path.split(/[\\/]/).pop()
    if (!parent) return null
    const listing = await window.finder.listDirectory(parent)
    const item = (listing.items || []).find((i) => i.name === name)
    return item ? { ...item, path } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function snapshot() {
  return {
    columns: state.columns.map((column) => ({ ...column })),
    activeSidebar: state.activeSidebar,
    selected: state.selected
  }
}

function pushHistory() {
  backStack.push(snapshot())
  if (backStack.length > 200) backStack.shift()
  forwardStack = []
}

function restore(entry) {
  state.columns = entry.columns
  state.activeSidebar = entry.activeSidebar
  state.selected = entry.selected ?? null
  render()
  renderSidebar()
}

/** Read a folder and return a column object. Errors become a column with a message. */
async function readColumn(path, { selectedName = null } = {}) {
  const result = await window.finder.listDirectory(path)
  if (!result.ok) {
    return { path, items: [], selectedName, error: result.error }
  }
  return { path: result.path, items: sortItems(result.items), selectedName }
}

/** Open a folder as the ONLY column — a fresh location (sidebar, crumb, up). */
async function openFolder(path) {
  if (!path) return
  pushHistory()
  state.activeSidebar = path
  state.columns = [await readColumn(path)]
  state.selected = null
  state.selection = []
  state.anchorName = null
  state.filter = ''
  el.search.value = ''
  render()
  renderSidebar()
  showColumnError(state.columns[0])
}

/** Descend: add a column after `index`, dropping anything deeper. */
async function descend(index, item) {
  const parent = state.columns[index]
  const childPath = await window.finder.joinPath(parent.path, item.name)
  state.columns = state.columns.slice(0, index + 1)
  state.columns[index].selectedName = item.name
  state.columns.push(await readColumn(childPath))
  state.selected = { ...item, path: childPath }
  state.selection = [state.selected]
  state.anchorName = item.name
  render()
  showColumnError(activeColumn())
}

/** Selecting a folder in a column previews its contents, exactly like Finder. */
async function selectInColumn(index, name) {
  const column = state.columns[index]
  if (!column) return

  // Resolve the FULL item from the column, not from the DOM. The DOM carries only
  // name/kind for the row; the size and date live on the item, and the status bar
  // and preview both need them.
  const item = column.items.find((i) => i.name === name)
  if (!item) return

  column.selectedName = name
  const path = await window.finder.joinPath(column.path, name)
  state.selected = { ...item, path }
  state.selection = [state.selected]
  state.anchorName = item.name

  if (item.isDirectory) {
    state.columns = state.columns.slice(0, index + 1)
    state.columns.push(await readColumn(path))
  } else {
    state.columns = state.columns.slice(0, index + 1)
  }
  render()
  showColumnError(activeColumn())
}

function showColumnError(column) {
  if (column && column.error) {
    const banner = document.createElement('p')
    banner.className = 'error'
    banner.textContent = column.error
    el.content.prepend(banner)
  }
}

/**
 * Selecting items, including more than one.
 *
 * `state.selected` remains the LEAD item — the one the preview and status bar describe —
 * and `state.selection` holds every selected item. Keeping the lead separate means the
 * hundred places that read `state.selected` keep working, and a multi-selection still has
 * a definite answer to "which file are you showing me".
 *
 * The anchor is what Shift+click extends from, so a range is a range and not a guess.
 */
function selectedItems() {
  return state.selection
}

function selectionNames() {
  return new Set(state.selection.map((i) => i.name))
}

/** Is this item part of the current selection? */
function isSelected(name) {
  return state.selection.some((i) => i.name === name)
}

/** The active column's items in DISPLAY order — the order a range is taken in. */
function orderedItems() {
  const column = activeColumn()
  return column ? presentItems(column.items) : []
}

/**
 * Apply a click to the selection.
 *
 * - plain click: select just this item, and make it the anchor
 * - Ctrl+click: add or remove this item, leaving the rest alone
 * - Shift+click: select everything from the anchor to here, in display order
 */
function applySelection(name, { shift = false, ctrl = false } = {}) {
  const items = orderedItems()
  const item = items.find((i) => i.name === name)
  if (!item) return

  if (shift && state.anchorName) {
    const from = items.findIndex((i) => i.name === state.anchorName)
    const to = items.findIndex((i) => i.name === name)
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      const range = items.slice(lo, hi + 1)
      // Shift replaces the selection with the range; Ctrl+Shift would add to it, but a
      // replace is what a file manager does and what people expect.
      state.selection = ctrl ? dedupe([...state.selection, ...range]) : range
      state.selected = { ...item }
      return
    }
  }

  if (ctrl) {
    const already = isSelected(name)
    state.selection = already
      ? state.selection.filter((i) => i.name !== name)
      : dedupe([...state.selection, item])
    // Removing the lead item must move the lead somewhere definite.
    if (already && state.selected?.name === name) {
      state.selected = state.selection.length ? state.selection[state.selection.length - 1] : null
    } else if (!already) {
      state.selected = { ...item }
    }
    state.anchorName = name
    return
  }

  state.selection = [item]
  state.selected = { ...item }
  state.anchorName = name
}

/** Selection entries are unique by name; two clicks must not double-count. */
function dedupe(items) {
  const seen = new Set()
  return items.filter((i) => (seen.has(i.name) ? false : seen.add(i.name)))
}

/**
 * Shift+Arrow: grow or shrink the selection by one row.
 *
 * The anchor stays put and the LEAD moves, which is how a range feels: you hold the
 * anchor with one hand and move the other end.
 */
function extendSelection(delta) {
  const items = orderedItems()
  if (items.length === 0) return
  const lead = items.findIndex((i) => i.name === state.selected?.name)
  if (lead === -1) return
  const target = Math.min(items.length - 1, Math.max(0, lead + delta))
  if (target === lead) return

  const anchor = state.anchorName ?? items[lead].name
  const from = items.findIndex((i) => i.name === anchor)
  const [lo, hi] = from <= target ? [from, target] : [target, from]
  state.selection = items.slice(lo, hi + 1)
  state.selected = { ...items[target] }
  render()
}

/** Move the selection by one row, within the column the selection lives in. */
function moveSelection(delta) {
  // Finder moves the selection in the FOCUSED column, not the front one. After
  // selecting a folder the preview column is empty, so moving in the front column
  // would make the arrow keys appear dead.
  let index = state.columns.findIndex((c) => c.selectedName === state.selected?.name)
  if (index === -1) index = state.columns.length - 1

  const column = state.columns[index]
  if (!column) return

  const items = presentItems(column.items)
  if (items.length === 0) return

  const current = items.findIndex((i) => i.name === state.selected?.name)
  const nextIndex = current === -1 ? 0 : Math.min(items.length - 1, Math.max(0, current + delta))
  const next = items[nextIndex]
  if (!next || next.name === state.selected?.name) return

  selectInColumn(index, next.name)

  requestAnimationFrame(() => {
    const row = el.content.querySelector('.row.is-selected')
    row?.scrollIntoView({ block: 'nearest' })
    // Move real DOM focus to the selected row. Selection and focus are the same thing in a
    // listbox: without this a screen reader keeps reading the toolbar while the highlight
    // moves down the list, so the arrow keys were silent.
    if (document.activeElement?.classList.contains('row')) row?.focus({ preventScroll: true })
  })
}

async function goBack() {
  const entry = backStack.pop()
  if (!entry) return
  forwardStack.push(snapshot())
  restore(entry)
}

async function goForward() {
  const entry = forwardStack.pop()
  if (!entry) return
  backStack.push(snapshot())
  restore(entry)
}

async function goUp() {
  const path = activePath()
  if (!path) return
  const parent = await window.finder.parentPath(path)
  if (parent) openFolder(parent)
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/** Ask for a name in a small inline dialog, then resolve with it (or null). */
function promptForName({ title, value, confirmLabel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal'
    overlay.innerHTML = `
      <form class="modal-card">
        <h2 class="modal-title"></h2>
        <input class="modal-input" type="text" autocomplete="off" spellcheck="false">
        <p class="modal-error" role="alert"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-action="cancel">Cancel</button>
          <button type="submit" class="btn-primary"></button>
        </div>
      </form>`

    overlay.querySelector('.modal-title').textContent = title
    overlay.querySelector('.btn-primary').textContent = confirmLabel
    const input = overlay.querySelector('.modal-input')
    input.value = value ?? ''
    const errorLine = overlay.querySelector('.modal-error')

    const close = (result) => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(null)
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null)
    })
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null))

    overlay.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      if (input.value.trim() === '') {
        errorLine.textContent = 'A name is required.'
        return
      }
      close(input.value)
    })

    document.addEventListener('keydown', onKey, true)
    document.body.append(overlay)
    input.focus()
    // Preselect the stem so typing replaces the name but keeps the extension.
    const dot = input.value.lastIndexOf('.')
    if (dot > 0) input.setSelectionRange(0, dot)
    else input.select()
  })
}

/**
 * Ask a yes/no question, and get an answer either way.
 *
 * Built on the same modal-card as promptForName so it looks and behaves like the rest of
 * the app rather than like a browser `confirm()`. Focus lands on Cancel, not on the
 * destructive button: the safe answer is the one you get by pressing Enter out of habit.
 */
function confirmDialog({ title, body, confirmLabel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal'
    overlay.innerHTML = `
      <form class="modal-card" role="dialog" aria-modal="true">
        <h2 class="modal-title"></h2>
        <p class="modal-body"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-action="cancel"></button>
          <button type="submit" class="btn-primary"></button>
        </div>
      </form>`

    overlay.querySelector('.modal-title').textContent = title
    overlay.querySelector('.modal-body').textContent = body
    overlay.querySelector('.btn-secondary').textContent = 'Cancel'
    overlay.querySelector('.btn-primary').textContent = confirmLabel

    const close = (result) => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(false)
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false)
    })
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false))
    overlay.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      close(true)
    })

    document.addEventListener('keydown', onKey, true)
    document.body.append(overlay)
    // Cancel first, on purpose.
    overlay.querySelector('.btn-secondary').focus()
  })
}

/**
 * Ask what to do about names that already exist, and get one of three answers.
 *
 * Asked BEFORE the transfer runs, not after it fails. The alternative — try it, then
 * report "3 items already exist" and make the user choose and retry — costs them the whole
 * operation to learn something the app could have asked up front.
 *
 * There is no "Replace" button. Overwriting is the one action in this app that destroys
 * data, and every other destructive path here asks first; offering it in a dialog the user
 * reaches by pasting would make it the fastest way to lose a file. That option needs the
 * owner's decision.
 */
function askConflictChoice(conflicts) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal'
    const many = conflicts.length > 1
    overlay.innerHTML = `
      <form class="modal-card" role="dialog" aria-modal="true">
        <h2 class="modal-title">These already exist</h2>
        <p class="modal-body"></p>
        <div class="modal-actions modal-actions-stack">
          <button type="button" class="btn-primary" data-choice="skip"></button>
          <button type="button" class="btn-secondary" data-choice="keep-both"></button>
          <button type="button" class="btn-secondary" data-choice="cancel">Cancel</button>
        </div>
      </form>`

    overlay.querySelector('.modal-body').textContent = many
      ? `${conflicts.length} items are already in the destination folder. What should happen to them?`
      : `“${conflicts[0]}” is already in the destination folder. What should happen to it?`
    const skip = overlay.querySelector('[data-choice="skip"]')
    const keep = overlay.querySelector('[data-choice="keep-both"]')
    skip.textContent = many ? 'Skip them' : 'Skip it'
    keep.textContent = many ? 'Keep both' : 'Keep both'

    const close = (result) => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(null)
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null)
    })
    for (const button of overlay.querySelectorAll('[data-choice]')) {
      button.addEventListener('click', () => close(button.dataset.choice))
    }
    overlay.querySelector('form').addEventListener('submit', (event) => event.preventDefault())

    document.addEventListener('keydown', onKey, true)
    document.body.append(overlay)
    // Focus lands on Skip: the answer that changes nothing is the safe default.
    skip.focus()
  })
}

/**
 * Run an operation, and if the name is refused, re-ask with the reason shown. A
 * rejected name is a normal thing to correct, not a dead end.
 */
async function runNameOperation(request, { title, confirmLabel }) {
  let value = request.name
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await window.finder.fileOperation({ ...request, name: value })
    if (result.ok) {
      await refreshAfterMutation()
      return result
    }
    if (/already an item named|reserved|cannot|not allowed/i.test(result.error)) {
      const retry = await promptForName({ title: `${title} — ${result.error}`, value, confirmLabel })
      if (retry === null) return { ok: false, cancelled: true }
      value = retry
      continue
    }
    showToast(result.error)
    return result
  }
  return { ok: false }
}

/** "New Folder", then "New Folder 2" — the convention Finder uses. */
function suggestFolderName(existing) {
  if (!existing.some((n) => n.toLowerCase() === 'new folder')) return 'New Folder'
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `New Folder ${index}`
    if (!existing.some((n) => n.toLowerCase() === candidate.toLowerCase())) return candidate
  }
  return `New Folder ${Date.now()}`
}

async function createFolder() {
  const path = activePath()
  if (!path) return
  const existing = (activeColumn()?.items ?? []).map((i) => i.name)
  const name = await promptForName({
    title: 'New Folder',
    value: suggestFolderName(existing),
    confirmLabel: 'Create'
  })
  if (name === null) return
  await runNameOperation(
    { op: 'create-folder', path, name },
    { title: 'New Folder', confirmLabel: 'Create' }
  )
}

async function renameSelected() {
  const item = state.selected
  if (!item) return
  const path = item.path || (await window.finder.joinPath(activePath(), item.name))
  const name = await promptForName({
    title: `Rename “${item.name}”`,
    value: item.name,
    confirmLabel: 'Rename'
  })
  if (name === null || name === item.name) return
  await runNameOperation({ op: 'rename', path, name }, { title: 'Rename', confirmLabel: 'Rename' })
}

/**
 * Move everything selected to the Recycle Bin.
 *
 * A batch must be all-or-nothing in its REPORTING: if three of five fail, saying
 * "5 moved" is a lie. Each result is counted, and a partial failure names how many
 * actually went.
 */
async function trashSelected() {
  const items = selectedItems()
  if (items.length === 0) return

  /**
   * Confirm before a destructive action that cannot be judged by its size.
   *
   * A single file is a normal, expected action and gets no dialog. Two or more is not:
   * `Ctrl+A` followed by `Delete` — the shortcut the audit flagged — bins the whole folder
   * with no prompt and no way back beyond the Recycle Bin. A FOLDER is confirmed even on
   * its own, because what it contains is not visible from here and the count of what will
   * go is the one thing the user cannot see.
   *
   * The message names the count rather than asking a vague "are you sure": a dialog that
   * does not say what is about to happen is a dialog people click through.
   */
  const folder = items.find((i) => i.isDirectory)
  if (items.length > 1 || folder) {
    const what = items.length === 1
      ? `the folder “${items[0].name}” and everything in it`
      : `${items.length} items`
    const ok = await confirmDialog({
      title: 'Move to Recycle Bin',
      body: `Move ${what} to the Recycle Bin?`,
      confirmLabel: 'Move to Recycle Bin'
    })
    if (!ok) {
      announce('Cancelled. Nothing was moved.')
      return
    }
  }

  let moved = 0
  const failures = []
  for (const item of items) {
    const path = item.path || (await window.finder.joinPath(activePath(), item.name))
    const result = await window.finder.fileOperation({ op: 'trash', path })
    if (result.ok) moved += 1
    else failures.push(`${item.name}: ${result.error}`)
  }

  state.selected = null
  state.selection = []
  state.anchorName = null
  await refreshAfterMutation()

  if (failures.length === 0) {
    showToast(
      moved === 1
        ? `“${items[0].name}” moved to the Recycle Bin.`
        : `${moved} items moved to the Recycle Bin.`
    )
    return
  }
  // Say exactly what happened rather than rounding to a success.
  showToast(
    moved === 0
      ? `Nothing was moved. ${failures[0]}`
      : `${moved} moved, ${failures.length} could not be: ${failures[0]}`
  )
}

/** Re-read the columns in place, keeping the user where they were. */
async function refreshAfterMutation() {
  const paths = state.columns.map((c) => c.path)
  const selectedNames = state.columns.map((c) => c.selectedName)
  const fresh = []
  for (let index = 0; index < paths.length; index += 1) {
    const column = await readColumn(paths[index], { selectedName: selectedNames[index] })
    fresh.push(column)
    // If a column no longer exists (its folder was renamed or trashed), stop there.
    if (column.error) break
  }
  state.columns = fresh
  const stillThere = fresh.some((c) => c.items.some((i) => i.name === state.selected?.name))
  if (!stillThere) state.selected = null
  state.selection = []
  state.anchorName = null
  render()
  showColumnError(activeColumn())
}

/**
 * Re-list the folders on screen, keeping the selection.
 *
 * Distinct from refreshAfterMutation, which drops the selection because the operation
 * just invalidated it. Here the user did nothing: another program created a file, and
 * losing the selection because someone else saved a document would be maddening.
 */
async function refreshLive() {
  const paths = state.columns.map((c) => c.path)
  const selectedNames = state.columns.map((c) => c.selectedName)
  const keepLead = state.selected?.name ?? null
  const keepSelection = selectionNames()
  // A live refresh is triggered by something the user did NOT do — another program saved
  // a file. Jumping their scroll position to the top is how a "live" folder becomes
  // irritating, so where each column was scrolled is captured and restored.
  const scrollTops = [...document.querySelectorAll('.column')].map((c) => c.scrollTop)

  const fresh = []
  for (let index = 0; index < paths.length; index += 1) {
    fresh.push(await readColumn(paths[index], { selectedName: selectedNames[index] }))
  }
  state.columns = fresh

  // Re-apply the selection to the NEW items, so a row keeps its identity by name.
  const lead = fresh.flatMap((c) => c.items).find((i) => i.name === keepLead)
  state.selected = lead ? { ...lead } : null
  state.selection = fresh.flatMap((c) => c.items).filter((i) => keepSelection.has(i.name))
  if (!lead) state.anchorName = null
  render()

  const columns = [...document.querySelectorAll('.column')]
  columns.forEach((column, index) => {
    if (scrollTops[index] !== undefined) column.scrollTop = scrollTops[index]
  })
}

/** Start watching the folders on screen, so a change on disk shows up on its own. */
function syncWatchers() {
  if (typeof window.finder.watchFolders !== 'function') return
  const paths = state.columns.map((c) => c.path).filter(Boolean)
  window.finder.watchFolders(paths).catch(() => {})
}

/**
 * Say something to a screen reader.
 *
 * Everything the app tells the user visually has to be said out loud too, or the app is
 * silent to anyone who cannot see it: the status count changing, a toast appearing and
 * vanishing three seconds later, a folder that failed to read. These regions are
 * `sr-only`, so this is additive and changes nothing on screen.
 *
 * The text is cleared first and set on the next frame. A live region only announces a
 * CHANGE, so writing the same sentence twice (select the same file again) would be silent
 * without the reset.
 */
function announce(message) {
  if (!el.announcer) return
  el.announcer.textContent = ''
  requestAnimationFrame(() => {
    el.announcer.textContent = message
  })
}

/** An error interrupts instead of waiting its turn: it needs attention now. */
function sayError(message) {
  if (!el.alerts) return
  el.alerts.textContent = ''
  requestAnimationFrame(() => {
    el.alerts.textContent = message
  })
}

function showToast(message) {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  // role=status so a toast is spoken as well as shown; it is the only channel by which
  // "Copied" or "2 of 3 done" reaches a screen-reader user.
  toast.setAttribute('role', 'status')
  document.body.append(toast)
  // Said through the announcer too: a role=status node that is REMOVED after 3s may be
  // dropped mid-sentence by some readers.
  announce(message)
  setTimeout(() => toast.classList.add('is-leaving'), 2600)
  setTimeout(() => toast.remove(), 3100)
}

/**
 * Copy a path to the clipboard, and SAY SO.
 *
 * The confirmation matters more than the copy: the clipboard is invisible, so without
 * a message the user cannot tell whether it worked and will paste to find out. Copying
 * always reports, including when it fails, because a silent failure here is
 * indistinguishable from a silent success.
 */
async function copyPath(text, { what = 'Path' } = {}) {
  const value = String(text ?? '')
  if (value === '') {
    showToast('Nothing to copy.')
    return { ok: false }
  }

  try {
    // Prefer the main process (Electron's clipboard module): it works on a file:// page
    // and needs no permission. The browser API is the fallback for the test harness and
    // any context without the bridge.
    let copied = false
    if (window.finder?.copyText) {
      const result = await window.finder.copyText(value)
      copied = Boolean(result?.ok)
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      copied = true
    }

    if (!copied) {
      showToast('Could not copy to the clipboard.')
      return { ok: false }
    }

    // Show the tail of a long path: the user needs to know WHICH one was copied, and a
    // 120-character path in a toast is unreadable.
    const short = value.length > 48 ? `…${value.slice(-45)}` : value
    showToast(`${what} copied — ${short}`)
    return { ok: true, value }
  } catch (error) {
    showToast('Could not copy to the clipboard.')
    return { ok: false, error: String(error) }
  }
}

/** Copy the selected item's path, or the current folder's when nothing is selected. */
async function copySelectedPath() {
  const target = state.selected?.path || activePath()
  const isFile = Boolean(state.selected?.path)
  return copyPath(target, { what: isFile ? 'Path' : 'Folder path' })
}

/** Copy just the name, which is what you want when naming a file elsewhere. */
async function copySelectedName() {
  const name = state.selected?.name
  if (!name) {
    showToast('Select an item first.')
    return { ok: false }
  }
  return copyPath(name, { what: 'Name' })
}

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------

/** The whole menu, in one place, so nothing exists only as a shortcut. */
const MENUS = {
  file: {
    label: 'File',
    items: [
      { label: 'New Folder', accel: 'Ctrl+Shift+N', run: createFolder },
      { separator: true },
      { label: 'Copy', accel: 'Ctrl+C', run: copySelection },
      { label: 'Cut', accel: 'Ctrl+X', run: cutSelection },
      { label: 'Paste', accel: 'Ctrl+V', disabled: true, note: 'Copy or cut something first', run: () => pasteInto() },
      { label: 'Select All', accel: 'Ctrl+A', run: selectAll },
      { separator: true },
      { label: 'Rename…', accel: 'F2', run: renameSelected },
      { label: 'Move to Recycle Bin', accel: 'Delete', run: trashSelected },
      { separator: true },
      { label: 'Copy Path', accel: 'Ctrl+Shift+C', run: copySelectedPath },
      { label: 'Copy Name', run: copySelectedName },
      { separator: true },
      { label: 'Open', accel: 'Enter', run: openSelected },
      { label: 'Open in Windows Explorer', run: revealSelected }
    ]
  },
  view: {
    label: 'View',
    items: [
      { label: 'as Columns', accel: 'Ctrl+1', run: () => setView('column') },
      { label: 'as List', accel: 'Ctrl+2', run: () => setView('list') },
      { label: 'as Icons', accel: 'Ctrl+3', run: () => setView('icon') },
      { separator: true },
      { label: 'Show Preview', accel: 'Ctrl+I', run: () => setPreviewOpen(!state.previewOpen) },
      { label: 'Quick Look', accel: 'Space', run: openQuickLook },
      {
        // A checkmark rather than a verb, so the entry states the current setting as well
        // as offering to change it — the user should not have to toggle it to find out.
        // A FUNCTION, because this menu is built once and a fixed string would freeze.
        label: () => (state.showHidden ? '✓ Show Hidden Files' : 'Show Hidden Files'),
        accel: 'Ctrl+Shift+H',
        run: () => toggleHidden()
      },
      { separator: true },
      { label: 'Keyboard Shortcuts', accel: 'Ctrl+/', run: showShortcuts },
      { separator: true },
      { label: 'Larger', accel: 'Ctrl+=', run: () => zoomBy(1) },
      { label: 'Smaller', accel: 'Ctrl+-', run: () => zoomBy(-1) },
      { label: 'Actual Size', accel: 'Ctrl+0', run: zoomReset },
      { separator: true },
      { label: 'Search', accel: 'Ctrl+F', run: () => { el.search.focus(); el.search.select() } },
      { label: 'Back to Folder', accel: 'Esc', run: exitSearch },
      { separator: true },
      { label: 'Build Search Index…', run: startIndexing }
    ]
  },
  go: {
    label: 'Go',
    items: [
      { label: 'Back', accel: 'Backspace', run: goBack },
      { label: 'Forward', accel: 'Alt+→', run: goForward },
      { label: 'Enclosing Folder', accel: 'Alt+↑', run: goUp },
      { separator: true },
      { label: 'Home', run: () => goToKnown('home') },
      { label: 'Desktop', run: () => goToKnown('desktop') },
      { label: 'Documents', run: () => goToKnown('documents') },
      { label: 'Downloads', run: () => goToKnown('downloads') },
      { label: 'Pictures', run: () => goToKnown('pictures') }
    ]
  },
  help: {
    label: 'Help',
    items: [{ label: 'Keyboard Shortcuts', run: showShortcuts }]
  }
}

let openMenu = null

function closeMenu() {
  if (!openMenu) return
  openMenu.remove()
  openMenu = null
  for (const item of document.querySelectorAll('.menubar-item')) item.classList.remove('is-open')
}

function toggleMenu(name, anchor) {
  const alreadyOpen = openMenu?.dataset.menu === name
  closeMenu()
  if (alreadyOpen) return

  const menu = MENUS[name]
  if (!menu) return

  const panel = document.createElement('div')
  panel.className = 'menu-panel'
  panel.dataset.menu = name

  for (const entry of menu.items) {
    if (entry.separator) {
      const line = document.createElement('div')
      line.className = 'menu-separator'
      panel.append(line)
      continue
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu-entry'

    const label = document.createElement('span')
    // A label may be a function, resolved at OPEN time. `MENUS` is a module constant, so a
    // plain string that depends on state is frozen at load: the "Show Hidden Files" check
    // mark could never appear, because it was computed once before the user could toggle it.
    label.textContent = typeof entry.label === 'function' ? entry.label() : entry.label
    button.append(label)

    if (entry.accel) {
      const accel = document.createElement('span')
      accel.className = 'menu-accel'
      accel.textContent = entry.accel
      button.append(accel)
    }

    // A checked mark for the two items whose state is visible.
    if (
      (entry.label === 'Show Preview' && state.previewOpen) ||
      (entry.label === 'as Columns' && state.view === 'column') ||
      (entry.label === 'as List' && state.view === 'list') ||
      (entry.label === 'as Icons' && state.view === 'icon')
    ) {
      button.classList.add('is-checked')
    }

    button.addEventListener('click', async () => {
      closeMenu()
      await entry.run()
    })
    panel.append(button)
  }

  const box = anchor.getBoundingClientRect()
  panel.style.left = `${Math.round(box.left)}px`
  panel.style.top = `${Math.round(box.bottom + 2)}px`
  document.body.append(panel)
  anchor.classList.add('is-open')
  openMenu = panel
}

async function goToKnown(id) {
  const sidebar = await window.finder.getSidebar()
  for (const section of sidebar.sections) {
    const match = section.items.find((i) => i.id === id)
    if (match?.path) return openFolder(match.path)
  }
  showToast('That folder is not on this machine.')
}

async function openSelected() {
  if (!state.selected) return
  const path = state.selected.path || (await window.finder.joinPath(activePath(), state.selected.name))
  if (state.selected.isDirectory) {
    const index = state.columns.findIndex((c) => c.selectedName === state.selected.name)
    await descend(index === -1 ? state.columns.length - 1 : index, state.selected)
  } else {
    await window.finder.openWithDefault(path)
  }
}

async function revealSelected() {
  if (!state.selected) return
  const path = state.selected.path || (await window.finder.joinPath(activePath(), state.selected.name))
  await window.finder.revealInExplorer(path)
}

function setView(view) {
  state.view = view
  for (const button of document.querySelectorAll('.seg')) {
    const active = button.dataset.view === view
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', active ? 'true' : 'false')
  }
  render()
}

/**
 * The keyboard shortcut sheet.
 *
 * Grouped and in two columns, because a flat list of seventeen rows is a wall, and the
 * thing a person wants is one group — "what does the preview do" — not the whole list.
 *
 * It is also COMPLETE: the previous version omitted Copy, Cut, Paste, Select All and
 * Refresh, which are the five keys someone is most likely to reach for.
 */
function showShortcuts() {
  const groups = [
    {
      name: 'Preview and Quick Look',
      rows: [
        ['Space', 'Quick Look — a full look at the selected item'],
        ['← / →', 'Previous / next file while Quick Look is open'],
        ['Ctrl+I', 'Show or hide the preview pane'],
        ['Ctrl+/', 'This list']
      ]
    },
    {
      name: 'Moving around',
      rows: [
        ['↑ / ↓', 'Move the selection'],
        ['Shift+↑ / ↓', 'Extend the selection'],
        ['Enter', 'Open'],
        ['Backspace', 'Back'],
        ['Alt+← / →', 'Back / Forward'],
        ['Alt+↑', 'Enclosing folder'],
        ['Esc', 'Close what is open, or leave the search'],
        ['F5', 'Refresh the folder']
      ]
    },
    {
      name: 'Files',
      rows: [
        ['Ctrl+C', 'Copy'],
        ['Ctrl+X', 'Cut'],
        ['Ctrl+V', 'Paste'],
        ['Ctrl+A', 'Select all'],
        ['F2', 'Rename'],
        ['Delete', 'Move to Recycle Bin'],
        ['Ctrl+Shift+N', 'New Folder'],
        ['Ctrl+Shift+C', 'Copy the path']
      ]
    },
    {
      name: 'The window',
      rows: [
        ['Ctrl+F', 'Search'],
        ['Ctrl+1 / 2 / 3', 'Columns / List / Icons'],
        ['Ctrl+= / Ctrl+-', 'Larger / smaller interface'],
        ['Ctrl+0', 'Actual size (100%)']
      ]
    }
  ]

  const overlay = document.createElement('div')
  overlay.className = 'modal'
  const card = document.createElement('div')
  card.className = 'modal-card modal-card-wide'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', 'Keyboard Shortcuts')

  const title = document.createElement('h2')
  title.className = 'modal-title'
  title.textContent = 'Keyboard Shortcuts'
  card.append(title)

  const columns = document.createElement('div')
  columns.className = 'shortcut-columns'
  for (const group of groups) {
    const section = document.createElement('section')
    section.className = 'shortcut-group'
    const heading = document.createElement('h3')
    heading.className = 'shortcut-group-title'
    heading.textContent = group.name
    const list = document.createElement('dl')
    list.className = 'shortcut-list'
    for (const [keys, what] of group.rows) {
      const dt = document.createElement('dt')
      // Each key is its own element so the sheet can draw them as keycaps, which is what
      // makes a shortcut list scannable rather than a paragraph of plus signs.
      for (const part of keys.split(' / ')) {
        const cap = document.createElement('kbd')
        cap.textContent = part
        dt.append(cap)
      }
      const dd = document.createElement('dd')
      dd.textContent = what
      list.append(dt, dd)
    }
    section.append(heading, list)
    columns.append(section)
  }
  card.append(columns)

  const actions = document.createElement('div')
  actions.className = 'modal-actions'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'btn-primary'
  close.textContent = 'Done'
  close.addEventListener('click', () => overlay.remove())
  actions.append(close)
  card.append(actions)

  overlay.append(card)
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove()
  })
  // Escape closes it, like every other panel in the app.
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      overlay.remove()
    }
  })
  document.body.append(overlay)
  close.focus()
}

for (const button of document.querySelectorAll('.menubar-item')) {
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleMenu(button.dataset.menu, button)
  })
  // Hovering another menu while one is open switches to it, as a menu bar should.
  button.addEventListener('mouseenter', () => {
    if (openMenu && openMenu.dataset.menu !== button.dataset.menu) {
      toggleMenu(button.dataset.menu, button)
    }
  })
}

document.addEventListener('click', (event) => {
  if (openMenu && !openMenu.contains(event.target)) closeMenu()
})

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

/**
 * The items for a given context. Kept beside MENUS because it is the same idea: a named
 * list of commands with their shortcuts, so the two can never drift apart in wording.
 *
 * Every entry names the SAME function the menu bar and the keyboard use. A context menu
 * that reimplements a command is how two behaviours get out of sync.
 */
function contextItemsFor(kind) {
  const hasSelection = Boolean(state.selected)

  if (kind === 'item') {
    return [
      { label: 'Open', accel: 'Enter', run: openSelected },
      { label: 'Open in Windows Explorer', run: revealSelected },
      { separator: true },
      { label: 'Quick Look', accel: 'Space', run: openQuickLook },
      { label: 'Show Preview', accel: 'Ctrl+I', run: () => setPreviewOpen(!state.previewOpen) },
      { separator: true },
      // The batch verbs name how many items they will act on, so a right-click on a
      // 5-item selection cannot be mistaken for acting on one file.
      { label: 'Tags…', run: () => openTagMenu() },
      { separator: true },
      { label: selectionCountLabel('Copy'), accel: 'Ctrl+C', run: copySelection },
      { label: selectionCountLabel('Cut'), accel: 'Ctrl+X', run: cutSelection },
      { separator: true },
      { label: 'Copy Path', accel: 'Ctrl+Shift+C', run: copySelectedPath },
      { label: 'Copy Name', run: copySelectedName },
      { separator: true },
      { label: 'Rename…', accel: 'F2', run: renameSelected },
      // Offered for a folder too. It used to be omitted here with a comment claiming the
      // app has "no recursive delete yet" — but the Recycle Bin does recursion natively,
      // and the File menu and the Delete key already bin folders. Hiding it in one of the
      // three places made the same command look available and unavailable at once.
      { label: 'Move to Recycle Bin', accel: 'Delete', run: trashSelected }
    ].filter(Boolean)
  }

  // Empty space in the folder listing.
  return [
    { label: 'New Folder', accel: 'Ctrl+Shift+N', run: createFolder },
    { separator: true },
    {
      label: clipboardHasItems()
        ? `Paste ${state.clipboard.items.length} ${state.clipboard.op === 'move' ? 'cut' : 'copied'} item${state.clipboard.items.length === 1 ? '' : 's'}`
        : 'Paste',
      accel: 'Ctrl+V',
      // Disabled with a reason beats a menu entry that silently does nothing.
      disabled: !clipboardHasItems(),
      note: 'Copy or cut something first',
      run: () => pasteInto()
    },
    { separator: true },
    { label: 'View as Columns', accel: 'Ctrl+1', run: () => setView('column') },
    { label: 'View as List', accel: 'Ctrl+2', run: () => setView('list') },
    { label: 'View as Icons', accel: 'Ctrl+3', run: () => setView('icon') },
    { separator: true },
    { label: 'Show Preview', accel: 'Ctrl+I', run: () => setPreviewOpen(!state.previewOpen) },
    { label: 'Larger', accel: 'Ctrl+=', run: () => zoomBy(1) },
    { label: 'Smaller', accel: 'Ctrl+-', run: () => zoomBy(-1) },
    { separator: true },
    { label: 'Copy Folder Path', accel: 'Ctrl+Shift+C', run: copySelectedPath, disabled: hasSelection }
  ]
}

/** Where a context menu should appear, kept inside the window. */
function placePanel(panel, x, y) {
  const margin = 6
  panel.style.left = '0px'
  panel.style.top = '0px'
  const box = panel.getBoundingClientRect()
  const left = Math.max(margin, Math.min(x, window.innerWidth - box.width - margin))
  const top = Math.max(margin, Math.min(y, window.innerHeight - box.height - margin))
  panel.style.left = `${Math.round(left)}px`
  panel.style.top = `${Math.round(top)}px`
}

/**
 * Open a context menu at the pointer.
 *
 * @param {MouseEvent} event
 * @param {'item'|'background'} kind
 */
function openContextMenu(event, kind) {
  closeMenu()
  const items = contextItemsFor(kind)

  const panel = document.createElement('div')
  panel.className = 'menu-panel menu-context'
  panel.dataset.menu = `context-${kind}`
  panel.setAttribute('role', 'menu')

  for (const entry of items) {
    if (entry.separator) {
      const line = document.createElement('div')
      line.className = 'menu-separator'
      panel.append(line)
      continue
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu-entry'
    button.setAttribute('role', 'menuitem')

    const label = document.createElement('span')
    label.textContent = entry.label
    button.append(label)

    if (entry.accel) {
      const accel = document.createElement('span')
      accel.className = 'menu-accel'
      accel.textContent = entry.accel
      button.append(accel)
    }

    if (entry.disabled) {
      // A greyed entry that explains itself beats a missing one: the user learns the
      // feature exists and what it is called.
      button.disabled = true
      button.title = entry.note || 'Not available yet'
    } else {
      button.addEventListener('click', async () => {
        closeMenu()
        await entry.run()
      })
    }

    panel.append(button)
  }

  // Appended before measuring, or the panel has no size to fit against the window.
  document.body.append(panel)
  placePanel(panel, event.clientX, event.clientY)
  openMenu = panel

  // Focus the first live entry so the keyboard works immediately, as a native menu does.
  const first = panel.querySelector('.menu-entry:not([disabled])')
  if (first) first.focus()
}

/** Kinds the preview can step through. A folder of four video takes is the whole point. */
const STEP_KINDS = new Set(['image', 'video', 'audio', 'pdf'])

/**
 * Step to the next or previous previewable asset in the folder.
 *
 * Two scopes, because both are wanted at different moments:
 *   - 'folder' (the default, and what the arrows do): flip through the takes in THIS
 *     folder, the way you review four versions of the same shot.
 *   - 'all': keep going across folder boundaries, which is what you want when walking a
 *     whole directory tree of assets.
 *
 * Selection is by NAME, not index, so the caller re-reads the folder and the state
 * stays honest if the directory changed underneath.
 *
 * @param {number} delta +1 forward, -1 back
 * @param {{ scope?: 'folder'|'all' }} [options]
 */
async function stepMedia(delta, { scope = 'folder' } = {}) {
  const column = activeColumn()
  if (!column) return { ok: false, error: 'No folder is open.' }

  const current = state.selected
  const pool = column.items.filter((item) => !item.isDirectory && STEP_KINDS.has(item.kind))
  if (pool.length === 0) {
    showToast('No images, video or audio to step through here.')
    return { ok: false, error: 'nothing to step through' }
  }

  const index = current ? pool.findIndex((item) => item.name === current.name) : -1
  let next = null

  if (index === -1) {
    // Nothing selected, or the selection is not previewable: start at the nearest end.
    next = delta > 0 ? pool[0] : pool[pool.length - 1]
  } else {
    const target = index + delta
    if (target >= 0 && target < pool.length) {
      next = pool[target]
    } else if (scope === 'all') {
      return stepAcrossFolders(delta)
    } else {
      // Say so rather than silently doing nothing: the end of the folder is information.
      showToast(delta > 0 ? 'That is the last item here.' : 'That is the first item here.')
      return { ok: false, error: 'at the end' }
    }
  }

  const pane = column.path === activePath() ? state.columns.length - 1 : state.columns.indexOf(column)
  await selectInColumn(pane === -1 ? state.columns.length - 1 : pane, next.name)
  return { ok: true, name: next.name }
}

/**
 * Step through the folder while Quick Look is open.
 *
 * Quick Look walks EVERY file, not only media: it is a look at the folder, and skipping
 * the text files between two images would make the arrows feel broken. (Stepping the
 * preview pane is the media-only gesture; this is the browsing one.)
 *
 * The overlay is refilled after moving, which is the part that was missing — moving the
 * selection without re-rendering left the overlay showing the previous file.
 */
async function stepQuickLook(delta) {
  const column = activeColumn()
  if (!column) return { ok: false, error: 'No folder is open.' }

  const pool = presentItems(column.items).filter((item) => !item.isDirectory)
  if (pool.length === 0) {
    showToast('No files to step through here.')
    return { ok: false, error: 'nothing to step through' }
  }

  const current = state.selected
  const index = current ? pool.findIndex((item) => item.name === current.name) : -1
  const target = index === -1 ? (delta > 0 ? 0 : pool.length - 1) : index + delta

  if (target < 0 || target >= pool.length) {
    showToast(delta > 0 ? 'That is the last file here.' : 'That is the first file here.')
    return { ok: false, error: 'at the end' }
  }

  const pane = column.path === activePath() ? state.columns.length - 1 : state.columns.indexOf(column)
  await selectInColumn(pane === -1 ? state.columns.length - 1 : pane, pool[target].name)
  // Re-open onto the new selection: this is what makes the arrow do something visible.
  await openQuickLook()
  return { ok: true, name: pool[target].name }
}

/** Walk to the neighbouring folder that has a previewable asset in the given direction. */
async function stepAcrossFolders(delta) {
  const column = activeColumn()
  const parent = await window.finder.parentPath(column.path)
  if (!parent) return { ok: false, error: 'no parent folder' }

  const siblings = await window.finder.listDirectory(parent)
  if (!siblings.ok) return { ok: false, error: siblings.error }

  const folders = siblings.items.filter((item) => item.isDirectory).map((item) => item.name)
  const here = folders.indexOf(baseName(column.path))
  if (here === -1) return { ok: false, error: 'not found in its parent' }

  for (let i = here + delta; i >= 0 && i < folders.length; i += delta) {
    const candidate = await window.finder.joinPath(parent, folders[i])
    const listing = await window.finder.listDirectory(candidate)
    if (!listing.ok) continue
    const first = listing.items.find((item) => !item.isDirectory && STEP_KINDS.has(item.kind))
    if (first) {
      await openFolder(candidate)
      await selectInColumn(state.columns.length - 1, first.name)
      return { ok: true, name: first.name, folder: candidate }
    }
  }

  showToast(delta > 0 ? 'No further media in the folders after this one.' : 'No media in the folders before this one.')
  return { ok: false, error: 'nothing further' }
}

/**
 * Show the step arrows only when there is something to step to.
 *
 * An arrow that does nothing is worse than no arrow, so the count of siblings is part
 * of the decision, not a decoration.
 */
function renderStepControls() {
  const column = activeColumn()
  const pool = column ? column.items.filter((i) => !i.isDirectory && STEP_KINDS.has(i.kind)) : []
  const index = state.selected ? pool.findIndex((i) => i.name === state.selected.name) : -1
  const many = pool.length > 1

  state.step = { total: pool.length, index, hasPrev: many && index > 0, hasNext: many && index !== -1 && index < pool.length - 1 }

  // The arrows describe a POSITION among the media, so they only belong on screen when
  // the selected item is one of them. On a text file they would show "0 of 4", which is
  // a number that means nothing.
  const show = Boolean(state.previewOpen && state.selected && !state.selected.isDirectory && index !== -1 && many)
  el.previewSteps.hidden = !show

  if (!show) return
  el.previewPrev.disabled = !state.step.hasPrev
  el.previewNext.disabled = !state.step.hasNext
  el.mediaCount.textContent = `${index + 1} of ${pool.length}`
  el.previewPrev.title = state.step.hasPrev ? 'Previous item (←)' : 'This is the first item'
  el.previewNext.title = state.step.hasNext ? 'Next item (→)' : 'This is the last item'
}

/**
 * Is the current selection one of the media assets that can be stepped through?
 * The arrow keys need to know whether they mean "next take" or "next row".
 */
function selectionIsMedia() {
  const column = activeColumn()
  if (!column || !state.selected) return false
  return column.items.some((i) => i.name === state.selected.name && !i.isDirectory && STEP_KINDS.has(i.kind))
}

/** Step to the previous or next previewable asset. */
function stepPrev() {
  return stepMedia(-1)
}

function stepNext() {
  return stepMedia(1)
}

/**
 * The tag picker for the current selection.
 *
 * A submenu of the seven colors rather than a text field: tags here are a fixed palette
 * (the same seven Finder uses), so offering the set is faster than typing and makes two
 * tags that mean the same thing impossible to create by spelling them differently.
 *
 * A tag the selection already carries is ticked, and clicking it removes it — one
 * control for both directions, which is how a toggle should behave.
 */
async function openTagMenu() {
  const items = selectedItems()
  if (items.length === 0) {
    showToast('Select something to tag first.')
    return
  }

  let current = new Set()
  try {
    const held = await window.finder.listTags()
    for (const item of items) {
      for (const [tag, paths] of Object.entries(held || {})) {
        if ((paths || []).includes(item.path)) current.add(tag)
      }
    }
  } catch {
    current = new Set()
  }

  const entries = Object.keys(TAG_COLORS).map((name) => ({
    label: current.has(name) ? `${name} ✓` : name,
    run: () => toggleTag(name, current.has(name))
  }))

  // Anchored to the row being tagged, so the picker appears where the user is looking.
  const anchor = document.querySelector('.row.is-selected') || el.content
  openMenuAt(anchor, entries)
}

/** Add or remove one tag on every selected item. */
async function toggleTag(name, removing) {
  const items = selectedItems()
  let changed = 0
  for (const item of items) {
    // The tag store keys on path + size + modified, so a stale signature cannot apply
    // one file's tags to a different file that later took its name.
    const record = {
      path: item.path || (await window.finder.joinPath(activePath(), item.name)),
      size: item.size ?? null,
      modifiedAt: item.modified ?? null
    }
    try {
      const result = removing
        ? await window.finder.untagItem(record, name)
        : await window.finder.tagItem(record, name)
      if (result?.ok !== false) changed += 1
    } catch {
      // A tag that fails to write must not abort the rest of the batch.
    }
  }
  await renderTagSection()
  renderSidebar()
  render()
  showToast(
    removing
      ? `Removed “${name}” from ${changed} item${changed === 1 ? '' : 's'}.`
      : `Tagged ${changed} item${changed === 1 ? '' : 's'} “${name}”.`
  )
}

/** "Copy" or "Copy 5 Items" — a batch verb should say how much it will act on. */
function selectionCountLabel(verb) {
  const n = state.selection.length
  return n > 1 ? `${verb} ${n} Items` : verb
}

/** Select every item in the folder being viewed. */
function selectAll() {
  state.selection = orderedItems().slice()
  state.selected = state.selection[0] ? { ...state.selection[0] } : null
  state.anchorName = state.selection[0]?.name ?? null
  render()
}

// ---------------------------------------------------------------------------
// Copy, cut and paste
// ---------------------------------------------------------------------------

/**
 * The file clipboard.
 *
 * Deliberately NOT the system clipboard: Windows' own file clipboard needs CF_HDROP,
 * which Electron cannot write before v44. Holding the selection in the app means
 * copy/paste works fully WITHIN the app now, and the system clipboard stays untouched
 * rather than being left in a half-written state another program would misread.
 */
function clipboardHasItems() {
  return Boolean(state.clipboard && state.clipboard.items.length > 0)
}

/** Copy the selection. Marks it so the rows can show they are queued. */
function copySelection() {
  const items = selectedItems()
  if (items.length === 0) {
    showToast('Select something to copy first.')
    return { ok: false }
  }
  state.clipboard = { op: 'copy', items: items.map((i) => ({ name: i.name, path: i.path })) }
  renderClipboardState()
  showToast(items.length === 1 ? `“${items[0].name}” copied.` : `${items.length} items copied.`)
  return { ok: true }
}

/** Cut the selection: pasting will move rather than copy. */
function cutSelection() {
  const items = selectedItems()
  if (items.length === 0) {
    showToast('Select something to cut first.')
    return { ok: false }
  }
  state.clipboard = { op: 'move', items: items.map((i) => ({ name: i.name, path: i.path })) }
  renderClipboardState()
  showToast(items.length === 1 ? `“${items[0].name}” cut.` : `${items.length} items cut.`)
  return { ok: true }
}

/**
 * Paste into the folder being viewed.
 *
 * The destination is the OPEN FOLDER, not the selection's folder: "copy these, go there,
 * paste" is the whole gesture, and pasting into the folder you are looking at is what
 * every file manager does.
 */
/**
 * The type-ahead buffer.
 *
 * Time-limited to just under a second, because the alternatives are both wrong: a buffer
 * that never expires turns every stray keystroke into a search for a 12-letter word, and
 * one that expires instantly can never match more than one letter.
 */
let typeAhead = { prefix: '', at: 0 }

/** Turn hidden files on or off, from the menu or the keyboard, saying which it now is. */
function toggleHidden() {
  state.showHidden = !state.showHidden
  render()
  showToast(state.showHidden ? 'Showing hidden files.' : 'Hiding hidden files.')
}

/** Jump the selection to the first item beginning with what has been typed. */
function jumpToTyped(character) {
  const column = activeColumn()
  if (!column) return false
  const items = presentItems(column.items)
  if (items.length === 0) return false

  const now = Date.now()
  const continuing = now - typeAhead.at < 900
  typeAhead.prefix = continuing ? typeAhead.prefix + character : character
  typeAhead.at = now

  const prefix = typeAhead.prefix.toLowerCase()
  const names = items.map((item) => item.name.toLowerCase())

  // Typing the same letter repeatedly ("ccc") cycles through the items starting with it,
  // which is what Explorer does and what people expect from a file list.
  const isRepeated = prefix.length > 1 && prefix.split('').every((c) => c === prefix[0])
  let match
  if (isRepeated) {
    const letter = prefix[0]
    const matches = names.map((n, i) => (n.startsWith(letter) ? i : -1)).filter((i) => i >= 0)
    if (matches.length === 0) return false
    const currentIndex = items.findIndex((i) => i.name === state.selected?.name)
    match = matches.find((i) => i > currentIndex) ?? matches[0]
  } else {
    // Starting from the selection, so typing a letter repeatedly walks down the matches.
    const from = items.findIndex((i) => i.name === state.selected?.name)
    match = names.findIndex((n, i) => n.startsWith(prefix) && i > from)
    if (match === -1) match = names.findIndex((n) => n.startsWith(prefix))
  }

  if (match === -1) return false
  const index = state.columns.indexOf(column)
  selectInColumn(index === -1 ? state.columns.length - 1 : index, items[match].name)
  requestAnimationFrame(() => {
    el.content.querySelector('.row.is-selected')?.scrollIntoView({ block: 'nearest' })
  })
  return true
}

/**
 * Which of these items already exist in the destination.
 *
 * Asked one by one through the existing `exists` check rather than by listing the
 * destination: the batch is what the user selected, and it is usually a handful of items,
 * so this costs a few cheap calls instead of reading a folder that may hold 50,000 files
 * just to answer a yes/no.
 */
async function collidingNames(items, destination) {
  const found = []
  for (const item of items) {
    const path = item.path || (await window.finder.joinPath(destination, item.name))
    const result = await window.finder.fileOperation({ op: 'exists', path })
    if (result?.exists) found.push(item.name)
  }
  return found
}

async function pasteInto(destination = activePath()) {
  if (!clipboardHasItems()) {
    showToast('Nothing has been copied yet.')
    return { ok: false }
  }
  if (!destination) {
    showToast('Open a folder to paste into.')
    return { ok: false }
  }

  const { op, items } = state.clipboard
  const transferRequest = { op, items, destination, onConflict: state.conflictChoice }

  // Ask up front, but only when it will matter: if nothing in the batch collides, the
  // question never appears and the paste is a single uninterrupted action.
  const collisions = await collidingNames(items, destination)
  if (collisions.length > 0 && !state.conflictChoice) {
    const choice = await askConflictChoice(collisions)
    if (choice === null) {
      announce('Cancelled. Nothing was transferred.')
      return { ok: false }
    }
    transferRequest.onConflict = choice
    // Remembered for the rest of the session so the second paste does not ask again.
    state.conflictChoice = choice
  }

  const result = await window.finder.transfer(transferRequest)

  if (!result.ok) {
    // A partial failure says exactly how far it got; a total failure says why.
    showToast(result.error || 'That did not work.')
    await refreshAfterMutation()
    return result
  }

  // A move consumes the clipboard — the items are no longer where they were, so
  // pasting them again would fail confusingly.
  if (op === 'move') {
    state.clipboard = null
    renderClipboardState()
  }
  await refreshAfterMutation()
  showToast(
    result.moved === 1
      ? `${op === 'move' ? 'Moved' : 'Copied'} 1 item.`
      : `${op === 'move' ? 'Moved' : 'Copied'} ${result.moved} items.`
  )
  return result
}

/**
 * Show which rows are on the clipboard.
 *
 * A cut that looks identical to a copy is how people lose track of what is about to
 * happen to their files, so the state is visible on the rows themselves.
 */
function renderClipboardState() {
  const names = new Set((state.clipboard?.items || []).map((i) => i.name))
  for (const row of document.querySelectorAll('.row, .icon-cell')) {
    const onClipboard = names.has(row.dataset.name)
    row.classList.toggle('is-clipped', onClipboard)
    row.classList.toggle('is-cut', onClipboard && state.clipboard?.op === 'move')
  }
  if (el.pasteHint) {
    el.pasteHint.hidden = !clipboardHasItems()
    if (clipboardHasItems()) {
      el.pasteHint.textContent = `${state.clipboard.items.length} ${state.clipboard.op === 'move' ? 'cut' : 'copied'} — Ctrl+V to paste here`
    }
  }
}

// ---------------------------------------------------------------------------
// Sort and filter
// ---------------------------------------------------------------------------

/** Re-sort and re-filter without touching the folder, then redraw. */
function refreshListing() {
  render()
}

const SORT_KEYS = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'size', label: 'Size' },
  { key: 'modified', label: 'Date Modified' }
]

/** The entries for the Sort menu, with the active key and direction shown. */
function sortMenuItems() {
  const items = SORT_KEYS.map(({ key, label }) => ({
    label,
    // A tick on the active key, and an arrow for the direction, so the menu states the
    // current order rather than making the user infer it.
    accel: state.sort.key === key ? (state.sort.ascending ? '✓ ↑' : '✓ ↓') : '',
    run: () => {
      if (state.sort.key === key) state.sort.ascending = !state.sort.ascending
      else {
        state.sort.key = key
        state.sort.ascending = true
      }
      renderSortLabel()
      refreshListing()
    }
  }))
  return items
}

/** The entries for the Filter menu: the kinds THIS folder actually contains. */
function filterMenuItems() {
  const column = activeColumn()
  const kinds = column ? availableKinds(column.items) : []
  const entries = kinds.map(({ kind, count }) => ({
    label: `${kindLabel(kind)} (${count})`,
    accel: state.kindFilter.has(kind) ? '✓' : '',
    run: () => {
      // Toggling, not replacing: "video and prompt text" is a real question.
      if (state.kindFilter.has(kind)) state.kindFilter.delete(kind)
      else state.kindFilter.add(kind)
      renderFilterLabel()
      refreshListing()
    }
  }))

  if (entries.length > 1) {
    entries.push({ separator: true })
    entries.push({
      label: 'Show All Types',
      disabled: state.kindFilter.size === 0,
      run: () => {
        state.kindFilter.clear()
        renderFilterLabel()
        refreshListing()
      }
    })
  }
  return entries
}

/** The label on the Sort button: the key, plus the direction when it is not the default. */
function renderSortLabel() {
  const entry = SORT_KEYS.find((k) => k.key === state.sort.key)
  const arrow = state.sort.ascending ? '↑' : '↓'
  el.sortLabel.textContent = `${entry ? entry.label : 'Name'} ${arrow}`
  el.sortBtn.classList.toggle('is-on', state.sort.key !== 'name' || !state.sort.ascending)
}

/** The label on the Filter button: what is being hidden, in words. */
function renderFilterLabel() {
  const count = state.kindFilter.size
  if (count === 0) {
    el.filterLabel.textContent = 'Filter'
    el.filterBtn.classList.remove('is-on')
    return
  }
  // Naming one kind is clearer than naming three, and the count covers the rest.
  const first = [...state.kindFilter][0]
  el.filterLabel.textContent = count === 1 ? kindLabel(first) : `${kindLabel(first)} +${count - 1}`
  el.filterBtn.classList.add('is-on')
}

/** A pattern field for the shot-naming case, shown only while a pattern is active. */
function renderPatternBar() {
  el.patternBar.hidden = !isFiltering() && state.pattern.trim() === ''
  if (!el.patternBar.hidden) el.patternInput.value = state.pattern
}

for (const [button, build] of [
  [el.sortBtn, sortMenuItems],
  [el.filterBtn, filterMenuItems]
]) {
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    openMenuAt(button, build())
  })
}

el.patternInput.addEventListener('input', () => {
  state.pattern = el.patternInput.value
  refreshListing()
})

el.patternClear.addEventListener('click', () => {
  state.pattern = ''
  el.patternInput.value = ''
  refreshListing()
})

el.filterClear.addEventListener('click', () => {
  state.kindFilter.clear()
  renderFilterLabel()
  refreshListing()
})

/** Open a menu panel anchored under a toolbar button. */
function openMenuAt(anchor, items) {
  closeMenu()
  const panel = document.createElement('div')
  panel.className = 'menu-panel menu-dropdown'
  panel.dataset.menu = 'dropdown'
  panel.setAttribute('role', 'menu')

  for (const entry of items) {
    if (entry.separator) {
      const line = document.createElement('div')
      line.className = 'menu-separator'
      panel.append(line)
      continue
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu-entry'
    button.setAttribute('role', 'menuitem')
    const label = document.createElement('span')
    label.textContent = entry.label
    button.append(label)
    if (entry.accel) {
      const accel = document.createElement('span')
      accel.className = 'menu-accel'
      accel.textContent = entry.accel
      button.append(accel)
    }
    if (entry.disabled) {
      button.disabled = true
    } else {
      button.addEventListener('click', async () => {
        closeMenu()
        await entry.run()
      })
    }
    panel.append(button)
  }

  document.body.append(panel)
  const box = anchor.getBoundingClientRect()
  placePanel(panel, box.left, box.bottom + 4)
  openMenu = panel
  anchor.setAttribute('aria-expanded', 'true')
  const first = panel.querySelector('.menu-entry:not([disabled])')
  if (first) first.focus()
}

// ---------------------------------------------------------------------------
// Interface size
// ---------------------------------------------------------------------------

/**
 * The interface scale, in steps.
 *
 * A step ladder rather than a free percentage: every step has been looked at, and a
 * slider invites settings nobody has checked. Ctrl+0 returns to 100%, which is the
 * escape hatch that makes experimenting safe.
 */
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/**
 * The index of 1.0, found rather than written down.
 *
 * Hardcoding this was wrong once already: the constant said 3 while 1.0 sits at index 2,
 * so "Actual Size" quietly jumped the interface to 110%.
 */
const ZOOM_DEFAULT_INDEX = Math.max(0, ZOOM_STEPS.indexOf(1))

/** A stored preference, or null when there is none. Never 0-by-accident. */
function readStoredZoom() {
  try {
    const raw = localStorage.getItem('zoomIndex')
    // `Number(null)` is 0, not NaN — treating "nothing stored" as index 0 would start
    // the app at 80% for everyone who has never touched the control.
    if (raw === null) return null
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value >= ZOOM_STEPS.length) return null
    return value
  } catch {
    return null
  }
}

function applyZoom(index) {
  const clamped = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index))
  const scale = ZOOM_STEPS[clamped]
  state.zoomIndex = clamped

  // Chromium page zoom via the main process is the primary mechanism: it scales text,
  // rows, columns, padding and images together. An earlier version set the root font
  // size and did NOTHING VISIBLE, because every size in the stylesheet is in px.
  const bridge = window.finder?.setZoom
  if (typeof bridge === 'function') {
    Promise.resolve(bridge(scale))
      .then((outcome) => {
        // Read back rather than assume: if the engine did not take the factor, say so
        // and fall back, because a control that silently does nothing is the exact
        // failure this replaced.
        if (!outcome || outcome.ok === false || Math.abs(outcome.factor - scale) > 0.001) {
          applyZoomFallback(scale)
          showToast('Interface size applied with a fallback — restart the app to make it stick.')
        }
      })
      .catch(() => applyZoomFallback(scale))
  } else {
    // No bridge (an older preload, or the render harness): still scale something.
    applyZoomFallback(scale)
  }

  el.zoomValue.textContent = `${Math.round(scale * 100)}%`
  el.zoomOut.disabled = clamped === 0
  el.zoomIn.disabled = clamped === ZOOM_STEPS.length - 1

  try {
    localStorage.setItem('zoomIndex', String(clamped))
  } catch {
    /* a private or read-only profile must not break the app */
  }
}

/** Last resort: CSS zoom on the document root. Chromium implements it, and it scales
 *  layout, not a picture of the layout. */
function applyZoomFallback(scale) {
  document.documentElement.style.zoom = scale === 1 ? '' : String(scale)
}

function zoomBy(delta) {
  applyZoom(state.zoomIndex + delta)
}

function zoomReset() {
  applyZoom(ZOOM_DEFAULT_INDEX)
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

el.content.addEventListener('contextmenu', async (event) => {
  const target = event.target.closest('.row, .icon-cell')
  if (!target) return
  event.preventDefault()

  // Right-clicking an item that is not selected SELECTS it first. Without this the menu
  // acts on whatever was selected before, which is the single most jarring thing a
  // context menu can do.
  const name = target.dataset.name
  if (target.classList.contains('row-result')) {
    state.selected = {
      name,
      path: target.dataset.path,
      isDirectory: false,
      kind: target.dataset.kind
    }
    render()
  } else {
    const pane = target.closest('.column')
    const index = pane ? Number(pane.dataset.index) : state.columns.length - 1
    if (state.columns[index]?.selectedName !== name) await selectInColumn(index, name)
  }

  openContextMenu(event, 'item')
})

el.content.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.row, .icon-cell')) return
  event.preventDefault()
  openContextMenu(event, 'background')
})

// The sidebar gets the same treatment: right-clicking a favorite is how people expect
// to act on it, even if the set of commands is short.
el.sidebar.addEventListener('contextmenu', (event) => {
  const target = event.target.closest('.sidebar-item')
  if (!target) return
  event.preventDefault()
  openContextMenu(event, 'background')
})

el.content.addEventListener('click', (event) => {
  const target = event.target.closest('.row, .icon-cell')
  if (!target) return

  // A search result carries its own full path and lives in no column, so it is
  // selected directly rather than through a column index.
  if (target.classList.contains('row-result')) {
    state.selected = {
      name: target.dataset.name,
      path: target.dataset.path,
      isDirectory: false,
      kind: target.dataset.kind
    }
    render()
    return
  }

  const pane = target.closest('.column')
  const index = pane ? Number(pane.dataset.index) : state.columns.length - 1

  // Ctrl and Shift change what the click MEANS. The lead item still descends into a
  // folder on a plain click, but a modified click is building a selection and must not
  // navigate away from the list being selected.
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    applySelection(target.dataset.name, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey })
    render()
    return
  }

  selectInColumn(index, target.dataset.name)
})

// Drag and drop, delegated the same way the click handlers are. A drag that starts in
// this app is handled from our own state; a drag that arrives from Explorer is resolved
// through the preload, which is the only side that can turn a File into a real path.
el.content.addEventListener('dragstart', onDragStart)
el.content.addEventListener('dragend', onDragEnd)
el.content.addEventListener('dragover', onDragOver)
el.content.addEventListener('drop', onDrop)
el.sidebar.addEventListener('dragover', onDragOver)
el.sidebar.addEventListener('drop', onDrop)
// Dropping on the window itself must not navigate away from the app, which is the
// browser default for a dropped file.
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

el.content.addEventListener('dblclick', async (event) => {
  const target = event.target.closest('.row, .icon-cell')
  if (!target) return

  // Opening a result must open THAT file where it lives, not a same-named file in
  // the folder that happens to be on screen.
  if (target.classList.contains('row-result')) {
    await window.finder.openWithDefault(target.dataset.path)
    return
  }

  const name = target.dataset.name
  const isDirectory = target.dataset.dir === '1'
  const path = await window.finder.joinPath(activePath(), name)

  if (isDirectory) {
    // In column view the preview column already exists; make it the front one.
    const pane = target.closest('.column')
    const index = pane ? Number(pane.dataset.index) : state.columns.length - 1
    if (state.view === 'column') descend(index, { name, isDirectory: true })
    else openFolder(path)
  } else {
    await window.finder.openWithDefault(path)
  }
})

el.sidebar.addEventListener('click', (event) => {
  const button = event.target.closest('.sidebar-item')
  if (!button) return
  openFolder(button.dataset.path)
})

el.breadcrumb.addEventListener('click', (event) => {
  const crumb = event.target.closest('.crumb')
  if (!crumb) return
  openFolder(crumb.dataset.path)
})

el.back.addEventListener('click', goBack)
el.forward.addEventListener('click', goForward)
el.up.addEventListener('click', goUp)

/** Clear the search and go back to the folder listing. */
function clearSearch() {
  exitSearch()
}

// Searching reads the index, so it is debounced: typing must not fire a query per key.
let searchTimer = null
el.search.addEventListener('input', () => {
  el.searchClear.hidden = el.search.value === ''
  if (searchTimer) clearTimeout(searchTimer)
  const text = el.search.value.trim()
  if (text === '') {
    exitSearch()
    return
  }
  searchTimer = setTimeout(() => {
    runSearch()
  }, 180)
})

el.searchClear.addEventListener('click', clearSearch)
el.searchExit.addEventListener('click', clearSearch)
el.scope.addEventListener('change', () => {
  if (state.searchText) runSearch()
})

el.indexAction.addEventListener('click', () => {
  if (state.index.running) window.finder.cancelIndex()
  else startIndexing()
})

el.indexDismiss.addEventListener('click', () => {
  state.indexDismissed = true
  renderIndexBar()
})

el.zoomIn.addEventListener('click', () => zoomBy(1))
el.zoomOut.addEventListener('click', () => zoomBy(-1))

// Click the path readout to copy it. The whole point is that this is one click, not a
// menu, so it works on the status bar text itself.
el.statusPath.addEventListener('click', () => copySelectedPath())

// Scan progress: the numbers move while it runs, so the wait is legible.
window.finder?.onIndexProgress?.((progress) => {
  state.index = { ...state.index, ...progress, running: !progress.done && !progress.cancelled, known: true }
  if (progress.done) state.index.running = false
  renderIndexBar()
})

// A folder on screen changed on disk. Re-list quietly: the user did nothing, so this
// must not steal focus, move the selection, or announce itself.
window.finder?.onFoldersChanged?.(() => {
  refreshLive().catch(() => {})
})

el.search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') clearSearch()
})

/** Show or hide the preview pane, and keep the toggle's own state truthful. */
function setPreviewOpen(open) {
  state.previewOpen = open
  document.body.classList.toggle('has-preview', open)
  el.previewToggle.classList.toggle('is-on', open)
  el.previewToggle.setAttribute('aria-pressed', open ? 'true' : 'false')
  render()
}

el.previewToggle.addEventListener('click', () => setPreviewOpen(!state.previewOpen))
el.previewClose.addEventListener('click', () => setPreviewOpen(false))
el.previewPrev.addEventListener('click', () => stepPrev())
el.previewNext.addEventListener('click', () => stepNext())
// Quick Look's own arrows. They walk every file, not only media, so they use the Quick
// Look stepper rather than the preview pane's media-only one.
el.quicklookPrev.addEventListener('click', () => stepQuickLook(-1))
el.quicklookNext.addEventListener('click', () => stepQuickLook(1))
el.quicklookClose.addEventListener('click', () => closeQuickLook())
el.quicklookBtn.addEventListener('click', () => openQuickLook())

el.quicklook.addEventListener('click', (event) => {
  if (event.target === el.quicklook) closeQuickLook()
})

for (const button of document.querySelectorAll('.seg')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view
    for (const other of document.querySelectorAll('.seg')) {
      const active = other === button
      other.classList.toggle('is-active', active)
      other.setAttribute('aria-pressed', active ? 'true' : 'false')
    }
    render()
  })
}

document.addEventListener('keydown', async (event) => {
  // The modal owns the keyboard while it is open.
  if (document.querySelector('.modal')) return

  // An open context menu owns the keyboard: arrows move, Enter runs, Escape closes.
  if (openMenu?.classList.contains('menu-context')) {
    const entries = [...openMenu.querySelectorAll('.menu-entry:not([disabled])')]
    const current = entries.indexOf(document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = (current + step + entries.length) % entries.length
      entries[next]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      document.activeElement?.click()
    }
    return
  }

  // Quick Look first: space opens it, and any of the usual keys close it.
  if (state.quickLookOpen) {
    if ([' ', 'Escape', 'Enter'].includes(event.key)) {
      event.preventDefault()
      closeQuickLook()
    } else if (event.key === 'ArrowRight') {
      // Stepping while Quick Look is open keeps it open — that is the whole point of a
      // full-screen look at a folder of takes.
      event.preventDefault()
      await stepQuickLook(1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      await stepQuickLook(-1)
    }
    return
  }

  if (event.target === el.search) return

  /**
   * A focused BUTTON owns Enter and Space — that is what a button is for.
   *
   * This handler is on `document` and preventDefaults these keys, so before this guard,
   * tabbing to the toolbar, the sidebar or a dialog button and pressing Enter or Space did
   * nothing at all: the app ran its own folder command instead of activating the control
   * the user had actually focused. Every keyboard-only user was blocked here, and it also
   * made Space unusable on any button because it opened Quick Look.
   *
   * Checked before every other branch, because this is a correctness rule about who owns
   * the key, not one command among many. The file list is not a button, so its own keys
   * (Enter opens, Space is Quick Look) still work exactly as before.
   */
  const active = document.activeElement
  const isButton = active && (active.tagName === 'BUTTON' || active.getAttribute('role') === 'button')
  if (isButton && (event.key === 'Enter' || event.key === ' ')) return

  const modifier = event.ctrlKey || event.metaKey

  /**
   * Type-ahead. Typing a letter jumps to the first item starting with it, and typing more
   * letters within a moment narrows from there — the behaviour of every file manager since
   * Windows 95, and its absence is one of the things that makes an app feel like a webpage.
   *
   * Only a bare printable character counts, so it cannot swallow a modifier combination:
   * `+` alone is type-ahead, Ctrl+`+` is still zoom. Space is excluded because it is Quick
   * Look, and the buffer is time-limited because a stale prefix would silently hijack the
   * next unrelated keystroke.
   */
  if (!modifier && !event.altKey && event.key.length === 1 && event.key !== ' ') {
    if (jumpToTyped(event.key)) {
      event.preventDefault()
      return
    }
  }

  // The shortcut sheet, on a key that is easy to hit and easy to remember. It belongs
  // here rather than buried in the Help menu alone: the owner did not know the app had a
  // Quick Look view, which is a discoverability failure, not a missing feature.
  if (modifier && (event.key === '/' || event.key === '?')) {
    event.preventDefault()
    showShortcuts()
    return
  }

  if (event.key === ' ') {
    event.preventDefault()
    if (state.selected) await openQuickLook()
  } else if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowLeft')) {
    event.preventDefault()
    goBack()
  } else if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault()
    goForward()
  } else if (event.key === 'ArrowUp' && event.altKey) {
    event.preventDefault()
    goUp()
  } else if (event.key === 'ArrowDown' && event.shiftKey) {
    event.preventDefault()
    extendSelection(1)
  } else if (event.key === 'ArrowUp' && event.shiftKey) {
    event.preventDefault()
    extendSelection(-1)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    // Stepping through the takes in a folder is what the owner asked for, but the arrows
    // must never be dead: on a file that is not media they move the selection instead.
    if (selectionIsMedia()) stepMedia(1)
    else moveSelection(1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (selectionIsMedia()) stepMedia(-1)
    else moveSelection(-1)
  } else if (event.key === 'Enter' && state.selected) {
    event.preventDefault()
    const index = state.columns.findIndex((c) => c.selectedName === state.selected.name)
    if (state.selected.isDirectory) descend(index === -1 ? state.columns.length - 1 : index, state.selected)
    else await window.finder.openWithDefault(state.selected.path)
  } else if (event.key === 'F2' || (modifier && event.key === 'r')) {
    event.preventDefault()
    await renameSelected()
  } else if (modifier && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
    event.preventDefault()
    await createFolder()
  } else if (event.key === 'Delete' || (modifier && event.key === 'Backspace')) {
    event.preventDefault()
    await trashSelected()
  } else if (modifier && event.key === 'i') {
    event.preventDefault()
    setPreviewOpen(!state.previewOpen)
  } else if (modifier && (event.key === '1' || event.key === '2' || event.key === '3')) {
    event.preventDefault()
    setView({ 1: 'column', 2: 'list', 3: 'icon' }[event.key])
  } else if (modifier && (event.key === '=' || event.key === '+')) {
    event.preventDefault()
    zoomBy(1)
  } else if (modifier && event.key === '-') {
    event.preventDefault()
    zoomBy(-1)
  } else if (modifier && event.key === '0') {
    event.preventDefault()
    zoomReset()
  } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'h') {
    event.preventDefault()
    toggleHidden()
  } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'c') {
    // Ctrl+Shift+C is the Windows convention for "copy the path"; plain Ctrl+C copies
    // the FILES. Both exist because they answer different questions.
    event.preventDefault()
    copySelectedPath()
  } else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    copySelection()
  } else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'x') {
    event.preventDefault()
    cutSelection()
  } else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    await pasteInto()
  } else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'a') {
    // Select every item in the folder being viewed.
    event.preventDefault()
    selectAll()
  } else if (event.key === 'F5') {
    // Refresh by hand, for the cases a watcher cannot cover: a network share, a folder
    // that could not be watched, or just wanting to be sure.
    event.preventDefault()
    await refreshLive()
  } else if (modifier && event.key === 'f') {
    event.preventDefault()
    el.search.focus()
    el.search.select()
  }
})

// ---------------------------------------------------------------------------
// First paint
// ---------------------------------------------------------------------------

;(async () => {
  if (!window.finder) {
    el.content.innerHTML = '<p class="error">The application bridge is unavailable.</p>'
    return
  }
  const start = await window.finder.startFolder()

  // Restore the interface size before anything is painted, so the window never visibly
  // resizes itself a moment after it appears.
  applyZoom(readStoredZoom() ?? ZOOM_DEFAULT_INDEX)
  await renderSidebar()
  state.activeSidebar = start
  state.columns = [await readColumn(start)]

  // Select the first FILE (not a folder): the preview pane is open by default, and a
  // selected folder has nothing to preview, so the pane would read as broken.
  const items = state.columns[0]?.items ?? []
  const firstFile = items.find((i) => !i.isDirectory) ?? items[0]
  document.body.classList.toggle('has-preview', state.previewOpen)

  if (firstFile) {
    await selectInColumn(0, firstFile.name)
  } else {
    render()
  }

  renderSidebar()
  showColumnError(state.columns[0])

  // Search state comes from the last scan, so the app can say whether searching
  // inside files will find anything before the user tries it.
  await refreshIndexStatus()
})()
