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
  breadcrumb: document.getElementById('breadcrumb'),
  preview: document.getElementById('preview'),
  previewBody: document.getElementById('previewBody'),
  previewName: document.getElementById('previewName'),
  previewMeta: document.getElementById('previewMeta'),
  previewToggle: document.getElementById('previewToggle'),
  previewClose: document.getElementById('previewClose'),
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
  quicklook: document.getElementById('quicklook'),
  quicklookBody: document.getElementById('quicklookBody'),
  quicklookName: document.getElementById('quicklookName'),
  quicklookMeta: document.getElementById('quicklookMeta')
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Column view is the default: it is the view that defines Finder. */
const state = {
  view: 'column',
  columns: [], // [{ path, items, selectedName }] — one entry per Miller column
  filter: '',
  selected: null, // { name, isDirectory, kind, path }
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
// Icons
// ---------------------------------------------------------------------------

const SVG = {
  folder:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 4.2c0-.7.6-1.2 1.2-1.2h3l1.3 1.5h6.1c.7 0 1.2.6 1.2 1.2v6.1c0 .7-.6 1.2-1.2 1.2H2.8c-.7 0-1.2-.6-1.2-1.2V4.2Z" fill="currentColor" opacity=".92"/></svg>',
  file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  home: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 14 7v7.2H2V7l6-5.2Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.2 14.2V9.4h3.6v4.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  drive: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="4" width="12.4" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.6" cy="8" r="1.1" fill="currentColor"/></svg>',
  removable:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="5.6" width="8" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.4 5.4V2.6h3.2v2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  network:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="3.4" cy="12.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12.6" cy="12.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.6 4.7 4.6 10.7M9.4 4.7l2 6M5.2 12.4h5.6" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>'
}

/** A distinct glyph per kind, so a glance tells you what a file is. */
const KIND_SVG = {
  image:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.6" cy="6.4" r="1.2" fill="currentColor"/><path d="M2.4 11.6 6 8.4l2.6 2.4 2.2-2 2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  video:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.4" width="9.4" height="9.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M11.4 7.4 14.4 5.6v4.8l-3-1.8Z" fill="currentColor"/></svg>',
  audio:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.4 3.2 12.4 2v8.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="4.8" cy="11.6" r="1.9" fill="currentColor"/><circle cx="10.8" cy="10.4" r="1.9" fill="currentColor"/></svg>',
  pdf: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.2 10.6h5.4M5.2 12.4h3.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  code: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.4 2.6 8 6 12.6M10 3.4 13.4 8 10 12.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  archive:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.4h2v3H7zM7 6.4h2v3H7z" fill="currentColor"/></svg>',
  spreadsheet:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3" width="12.4" height="10" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.8 6.6h12.4M6.6 3v10M1.8 10h12.4" stroke="currentColor" stroke-width="1.1"/></svg>',
  presentation:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 11v2.4M5.6 14h4.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  document:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.4 9h5.2M5.4 11h5.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  executable:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3" width="12.4" height="10" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.4 6.4 6.6 8l-2.2 1.6M8 10.4h3.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  text: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.4 9.2h5.2M5.4 11.2h3.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>'
}

function iconFor(item) {
  if (item.isDirectory) return SVG.folder
  return KIND_SVG[item.kind] || SVG.file
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
  const label = kind === 'other' ? 'Document' : kind[0].toUpperCase() + kind.slice(1)
  const extension = item.name.includes('.') ? item.name.split('.').pop().toUpperCase() : ''
  return extension && extension !== label.toUpperCase() ? `${label} (${extension})` : label
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Case-insensitive, and stable so the order never flickers between renders. */
function applyFilter(items) {
  const needle = state.filter.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => item.name.toLowerCase().includes(needle))
}

/** Folders first, then names — Finder's default ordering. */
function sortItems(items) {
  return items.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  if (state.searchText) renderSearchResults()
  else if (state.view === 'column') renderColumns()
  else if (state.view === 'list') renderList()
  else renderIcons()
  renderStatus()
  renderNavButtons()
  renderBreadcrumb()
  renderPreview()
  renderSearchBar()
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
  const shown = applyFilter(column.items)
  const folders = shown.filter((i) => i.isDirectory).length
  const parts = [pluralize(shown.length, 'item'), pluralize(folders, 'folder')]
  if (state.filter.trim() && shown.length !== column.items.length) {
    parts.push(`filtered from ${column.items.length}`)
  }
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
  row.setAttribute('role', 'option')
  row.setAttribute('aria-selected', 'false')

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
  header.innerHTML =
    '<span class="col-name">Name</span><span class="col-kind">Matched</span><span class="col-size">Size</span><span class="col-date">Date Modified</span>'
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

    const items = applyFilter(column.items)

    if (items.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'hint'
      empty.textContent = state.filter.trim() ? 'No matches here.' : 'Empty'
      pane.append(empty)
    } else {
      for (const item of items) {
        const row = buildRow(item)
        if (column.selectedName === item.name) {
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
  header.innerHTML =
    '<span class="col-name">Name</span><span class="col-kind">Kind</span><span class="col-size">Size</span><span class="col-date">Date Modified</span>'
  el.content.append(header)

  const items = applyFilter(column.items)
  if (items.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = state.filter.trim() ? 'No matches in this folder.' : 'This folder is empty.'
    el.content.append(empty)
    return
  }

  for (const item of items) {
    const row = buildRow(item, { showMeta: true })
    if (column.selectedName === item.name) {
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

  const items = applyFilter(column.items)
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
    if (column.selectedName === item.name) cell.classList.add('is-selected')

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
  if (!state.previewOpen || !state.selected || state.selected.isDirectory) {
    el.previewBody.replaceChildren()
    el.previewName.textContent = ''
    el.previewMeta.textContent = ''
    return
  }

  const item = state.selected
  const path = item.path || (await window.finder.joinPath(activePath(), item.name))
  const token = ++previewToken

  el.previewName.textContent = item.name
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
  if (item.size === null) add('Size', 'Unknown')
  add('Where', item.path ? item.path.slice(0, item.path.lastIndexOf('\\')) : null, { copy: true })
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

/** Read an image's natural size once it has decoded, and fill in the Dimensions row. */
function measureImage(img, block) {
  const apply = () => {
    if (!block || !img.naturalWidth) return
    const dt = document.createElement('dt')
    dt.textContent = 'Dimensions'
    const dd = document.createElement('dd')
    dd.textContent = `${img.naturalWidth} × ${img.naturalHeight}`
    // Dimensions read best right under Size, but the image is not decoded at build
    // time, so the row is inserted here once it is known.
    const anchor = [...block.querySelectorAll('dt')].find((node) => node.textContent === 'Kind')
    if (anchor) anchor.after(dt, dd)
    else block.prepend(dd), block.prepend(dt)
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
          const dt = document.createElement('dt')
          dt.textContent = 'Dimensions'
          const dd = document.createElement('dd')
          dd.textContent = `${video.videoWidth} × ${video.videoHeight}`
          const anchor = [...info.querySelectorAll('dt')].find((node) => node.textContent === 'Kind')
          if (anchor) anchor.after(dt, dd)
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
  fillPane(el.quicklookBody, preview, path, item.name)
}

function closeQuickLook() {
  state.quickLookOpen = false
  el.quicklook.hidden = true
  el.quicklookBody.replaceChildren()
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

/** Move the selection by one row, within the column the selection lives in. */
function moveSelection(delta) {
  // Finder moves the selection in the FOCUSED column, not the front one. After
  // selecting a folder the preview column is empty, so moving in the front column
  // would make the arrow keys appear dead.
  let index = state.columns.findIndex((c) => c.selectedName === state.selected?.name)
  if (index === -1) index = state.columns.length - 1

  const column = state.columns[index]
  if (!column) return

  const items = applyFilter(column.items)
  if (items.length === 0) return

  const current = items.findIndex((i) => i.name === state.selected?.name)
  const nextIndex = current === -1 ? 0 : Math.min(items.length - 1, Math.max(0, current + delta))
  const next = items[nextIndex]
  if (!next || next.name === state.selected?.name) return

  selectInColumn(index, next.name)

  requestAnimationFrame(() => {
    el.content.querySelector('.row.is-selected')?.scrollIntoView({ block: 'nearest' })
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

async function trashSelected() {
  const item = state.selected
  if (!item) return
  const path = item.path || (await window.finder.joinPath(activePath(), item.name))
  const result = await window.finder.fileOperation({ op: 'trash', path })
  if (!result.ok) {
    showToast(result.error)
    return
  }
  state.selected = null
  await refreshAfterMutation()
  showToast(`“${item.name}” moved to the Recycle Bin.`)
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
  render()
  showColumnError(activeColumn())
}

function showToast(message) {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  document.body.append(toast)
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
    label.textContent = entry.label
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

function showShortcuts() {
  const rows = [
    ['Arrows', 'Move the selection'],
    ['Space', 'Quick Look'],
    ['Enter', 'Open'],
    ['F2', 'Rename'],
    ['Ctrl+Shift+N', 'New Folder'],
    ['Delete', 'Move to Recycle Bin'],
    ['Ctrl+F', 'Search'],
    ['Esc', 'Back to the folder'],
    ['Ctrl+I', 'Show or hide the preview'],
    ['Ctrl+1 / 2 / 3', 'Columns / List / Icons'],
    ['Ctrl+= / Ctrl+-', 'Larger / smaller interface'],
    ['Ctrl+0', 'Actual size (100%)'],
    ['Ctrl+Shift+C', 'Copy the selected item’s path'],
    ['Backspace', 'Back'],
    ['Alt+← / →', 'Back / Forward'],
    ['Alt+↑', 'Enclosing folder']
  ]

  const overlay = document.createElement('div')
  overlay.className = 'modal'
  const card = document.createElement('div')
  card.className = 'modal-card modal-card-wide'
  const title = document.createElement('h2')
  title.className = 'modal-title'
  title.textContent = 'Keyboard Shortcuts'
  card.append(title)

  const list = document.createElement('dl')
  list.className = 'shortcut-list'
  for (const [keys, what] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = keys
    const dd = document.createElement('dd')
    dd.textContent = what
    list.append(dt, dd)
  }
  card.append(list)

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
    const isFolder = Boolean(state.selected?.isDirectory)
    return [
      { label: 'Open', accel: 'Enter', run: openSelected },
      { label: 'Open in Windows Explorer', run: revealSelected },
      { separator: true },
      { label: 'Quick Look', accel: 'Space', run: openQuickLook },
      { label: 'Show Preview', accel: 'Ctrl+I', run: () => setPreviewOpen(!state.previewOpen) },
      { separator: true },
      { label: 'Copy Path', accel: 'Ctrl+Shift+C', run: copySelectedPath },
      { label: 'Copy Name', run: copySelectedName },
      { separator: true },
      { label: 'Rename…', accel: 'F2', run: renameSelected },
      // A folder cannot be renamed away while you are standing in it, and this app has
      // no recursive delete yet, so the honest thing is not to offer it.
      isFolder ? null : { label: 'Move to Recycle Bin', accel: 'Delete', run: trashSelected }
    ].filter(Boolean)
  }

  // Empty space in the folder listing.
  return [
    { label: 'New Folder', accel: 'Ctrl+Shift+N', run: createFolder },
    { separator: true },
    { label: 'Paste', accel: 'Ctrl+V', disabled: true, note: 'Coming soon' },
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
  selectInColumn(index, target.dataset.name)
})

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
    }
    return
  }

  if (event.target === el.search) return

  const modifier = event.ctrlKey || event.metaKey

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
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
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
  } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'c') {
    // Ctrl+Shift+C is the Windows convention for "copy the path" (Ctrl+C is reserved
    // for copying the file itself, which is coming with multi-select).
    event.preventDefault()
    copySelectedPath()
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
