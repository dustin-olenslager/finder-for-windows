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
  previewClose: document.getElementById('previewClose'),
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
  columns: [], // [{ path, items, selectedName, error }]
  filter: '',
  selected: null, // { name, isDirectory, kind, path }
  activeSidebar: null,
  previewOpen: false,
  quickLookOpen: false
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
  if (state.view === 'column') renderColumns()
  else if (state.view === 'list') renderList()
  else renderIcons()
  renderStatus()
  renderNavButtons()
  renderBreadcrumb()
  renderPreview()
}

function renderNavButtons() {
  el.back.disabled = backStack.length === 0
  el.forward.disabled = forwardStack.length === 0
  const path = activePath()
  el.up.disabled = !path || !canGoUp(path)
  el.title.textContent = state.columns.length ? baseName(path) || path : 'Finder for Windows'
  el.statusPath.textContent = path || ''
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

  fillPane(el.previewBody, preview, path, item.name)
}

/** Render one preview payload into a body element. */
function fillPane(body, preview, path, name) {
  body.replaceChildren()

  if (!preview.ok) {
    body.append(note('Could not preview this file.'))
    return
  }

  const fileUrl = `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`

  switch (preview.mode) {
    case 'image': {
      const image = document.createElement('img')
      image.src = fileUrl
      image.alt = name
      image.className = 'preview-image'
      image.addEventListener('error', () => {
        body.replaceChildren(note('This image could not be displayed.'))
      })
      body.append(image)
      return
    }
    case 'video': {
      const video = document.createElement('video')
      video.src = fileUrl
      video.controls = true
      video.className = 'preview-video'
      body.append(video)
      return
    }
    case 'audio': {
      const audio = document.createElement('audio')
      audio.src = fileUrl
      audio.controls = true
      audio.className = 'preview-audio'
      body.append(audio)
      return
    }
    case 'pdf': {
      const frame = document.createElement('iframe')
      frame.src = fileUrl
      frame.className = 'preview-pdf'
      frame.title = name
      body.append(frame)
      return
    }
    case 'text': {
      const pre = document.createElement('pre')
      pre.className = 'preview-text'
      pre.textContent = preview.text
      body.append(pre)
      if (preview.truncated) body.append(note('Showing the beginning of this file.'))
      return
    }
    default:
      body.append(note(preview.note || 'No preview for this file type.'))
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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

el.content.addEventListener('click', (event) => {
  const target = event.target.closest('.row, .icon-cell')
  if (!target) return
  const pane = target.closest('.column')
  const index = pane ? Number(pane.dataset.index) : state.columns.length - 1
  selectInColumn(index, target.dataset.name)
})

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

el.breadcrumb.addEventListener('click', (event) => {
  const crumb = event.target.closest('.crumb')
  if (!crumb) return
  openFolder(crumb.dataset.path)
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

el.previewClose.addEventListener('click', () => {
  state.previewOpen = false
  document.body.classList.remove('has-preview')
  render()
})

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
    state.previewOpen = !state.previewOpen
    document.body.classList.toggle('has-preview', state.previewOpen)
    render()
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
  await renderSidebar()
  state.activeSidebar = start
  state.columns = [await readColumn(start)]
  render()
  renderSidebar()
  showColumnError(state.columns[0])
})()
