'use strict'

/**
 * The renderer: view state and presentation only.
 *
 * It never touches the filesystem. Every listing arrives through window.finder,
 * which the preload exposes over IPC. Path arithmetic is done by the main process
 * (src/domain/paths.js) — the renderer never guesses at separators.
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
  statusPath: document.getElementById('statusPath')
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Column view is the default: it is the view that defines Finder. */
const state = {
  view: 'column',
  columns: [], // [{ path, items, selectedName }] — the last column is the front one
  filter: '',
  selected: null, // { path, name, isDirectory }
  activeSidebar: null
}

let backStack = []
let forwardStack = []

/** The folder whose contents are shown in the front column. */
function activePath() {
  const last = state.columns[state.columns.length - 1]
  return last ? last.path : null
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const SVG = {
  folder:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 4.2c0-.7.6-1.2 1.2-1.2h3l1.3 1.5h6.1c.7 0 1.2.6 1.2 1.2v6.1c0 .7-.6 1.2-1.2 1.2H2.8c-.7 0-1.2-.6-1.2-1.2V4.2Z" fill="currentColor" opacity=".92"/></svg>',
  file:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 2.2h5.2L12.6 6v7.8H3.4V2.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.4 2.4V6h3.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  home:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 14 7v7.2H2V7l6-5.2Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.2 14.2V9.4h3.6v4.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  drive:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="4" width="12.4" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.6" cy="8" r="1.1" fill="currentColor"/></svg>',
  removable:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="5.6" width="8" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.4 5.4V2.6h3.2v2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  network:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="3.4" cy="12.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12.6" cy="12.4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.6 4.7 4.6 10.7M9.4 4.7l2 6M5.2 12.4h5.6" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  tag: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
}

function iconFor(item) {
  return item.isDirectory ? SVG.folder : SVG.file
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
  if (state.view === 'column') renderColumns()
  else if (state.view === 'list') renderList()
  else renderIcons()
  renderStatus()
  renderNavButtons()
}

function renderNavButtons() {
  el.back.disabled = backStack.length === 0
  el.forward.disabled = forwardStack.length === 0
  const path = activePath()
  el.up.disabled = !path || !canGoUp(path)
  el.title.textContent = state.columns.length ? baseName(path) || path : 'Finder for Windows'
  el.statusPath.textContent = path || ''
}

/** The last segment of a path, for the window title. */
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
 * this is only used to disable the button, so it is deliberately conservative.
 */
function canGoUp(path) {
  if (/^[A-Za-z]:\\?$/.test(path)) return false
  if (path === '/') return false
  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?$/.test(path)) return false
  return true
}

function renderStatus() {
  const column = state.columns[state.columns.length - 1]
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
  if (state.selected) {
    const selectedItem = column.items.find((i) => i.name === state.selected.name)
    if (selectedItem && !selectedItem.isDirectory && typeof selectedItem.size === 'number') {
      parts.push(`selected: ${formatSize(selectedItem.size)}`)
    }
  }
  el.statusCount.textContent = parts.join(' · ')
}

/** One row inside a column or list. */
function buildRow(item, { showMeta = false } = {}) {
  const row = document.createElement('div')
  row.className = 'row' + (item.isDirectory ? ' is-dir' : '')
  row.dataset.name = item.name
  row.dataset.dir = item.isDirectory ? '1' : ''
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
    const size = document.createElement('span')
    size.className = 'col-size'
    size.textContent = item.isDirectory ? '--' : formatSize(item.size)

    const date = document.createElement('span')
    date.className = 'col-date'
    date.textContent = formatDate(item.modifiedAt)

    row.append(size, date)
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

  const column = state.columns[state.columns.length - 1]
  if (!column) return

  const header = document.createElement('div')
  header.className = 'list-header'
  header.innerHTML =
    '<span class="col-name">Name</span><span class="col-size">Size</span><span class="col-date">Date Modified</span>'
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

  const column = state.columns[state.columns.length - 1]
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
    if (column.selectedName === item.name) cell.classList.add('is-selected')

    const art = document.createElement('span')
    art.className = 'icon-art'
    art.innerHTML = item.isDirectory ? SVG.folder : SVG.file

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
    activeSidebar: state.activeSidebar
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
  state.selected = null
  render()
}

/** Read a folder and return a column object. Errors become a column with a message. */
async function readColumn(path, { selectedName = null } = {}) {
  const result = await window.finder.listDirectory(path)
  if (!result.ok) {
    return { path, items: [], selectedName, error: result.error }
  }
  return { path: result.path, items: sortItems(result.items), selectedName }
}

/** Open a folder as the ONLY column — a fresh location (sidebar, search, up). */
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
  state.selected = item
  render()
  showColumnError(state.columns[state.columns.length - 1])
}

/** Selecting a folder in a column previews its contents, exactly like Finder. */
async function selectInColumn(index, item) {
  if (state.columns[index]) state.columns[index].selectedName = item.name
  state.selected = item
  if (item.isDirectory) {
    state.columns = state.columns.slice(0, index + 1)
    const childPath = await window.finder.joinPath(state.columns[index].path, item.name)
    state.columns.push(await readColumn(childPath))
  } else {
    state.columns = state.columns.slice(0, index + 1)
  }
  render()
  showColumnError(state.columns[state.columns.length - 1])
}

function showColumnError(column) {
  if (column && column.error) {
    const banner = document.createElement('p')
    banner.className = 'error'
    banner.textContent = column.error
    el.content.prepend(banner)
  }
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
// Events
// ---------------------------------------------------------------------------

// Click: select. In column view a folder also previews the next column.
el.content.addEventListener('click', (event) => {
  const target = event.target.closest('.row, .icon-cell')
  if (!target) return
  const name = target.dataset.name
  const isDirectory = target.dataset.dir === '1'

  const pane = target.closest('.column')
  const index = pane ? Number(pane.dataset.index) : state.columns.length - 1

  selectInColumn(index, { name, isDirectory })
})

// Double click: open. Folders descend; files open in their default application.
el.content.addEventListener('dblclick', async (event) => {
  const target = event.target.closest('.row, .icon-cell')
  if (!target) return
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

el.back.addEventListener('click', goBack)
el.forward.addEventListener('click', goForward)
el.up.addEventListener('click', goUp)

el.search.addEventListener('input', () => {
  state.filter = el.search.value
  render()
})

el.search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    el.search.value = ''
    state.filter = ''
    render()
  }
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

document.addEventListener('keydown', (event) => {
  // Never steal keys from the search field.
  if (event.target === el.search) return

  if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowLeft')) {
    event.preventDefault()
    goBack()
  } else if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault()
    goForward()
  } else if (event.key === 'ArrowUp' && event.altKey) {
    event.preventDefault()
    goUp()
  } else if (event.key === 'Enter' && state.selected) {
    event.preventDefault()
    const pane = el.content.querySelector('.is-selected')?.closest('.column')
    const index = pane ? Number(pane.dataset.index) : state.columns.length - 1
    descend(index, state.selected)
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
  await renderSidebar()
  state.activeSidebar = start
  state.columns = [await readColumn(start)]
  render()
  renderSidebar()
  showColumnError(state.columns[0])
})()
