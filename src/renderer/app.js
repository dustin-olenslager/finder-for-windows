'use strict'

/**
 * M1 renderer — a deliberately minimal folder list that exercises the IPC bridge.
 *
 * The renderer holds view state only. It never touches the filesystem; every
 * listing comes from window.finder.listDirectory, which the preload exposes.
 */

const el = {
  back: document.getElementById('back'),
  up: document.getElementById('up'),
  path: document.getElementById('path'),
  count: document.getElementById('count'),
  content: document.getElementById('content')
}

/** Navigation history, so Back is a real behavior from the first milestone. */
const history = []
let current = null

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function renderItems(result) {
  el.content.replaceChildren()

  if (!result.ok) {
    const p = document.createElement('p')
    p.className = 'error'
    p.textContent = result.error
    el.content.append(p)
    el.count.textContent = ''
    return
  }

  const items = result.items
  const folders = items.filter((i) => i.isDirectory).length
  el.count.textContent = `${items.length} item${items.length === 1 ? '' : 's'} · ${folders} folder${folders === 1 ? '' : 's'}`

  if (items.length === 0) {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = 'This folder is empty.'
    el.content.append(p)
    return
  }

  const list = document.createElement('ul')
  list.className = 'list'

  for (const item of items) {
    const li = document.createElement('li')
    li.className = 'row' + (item.isDirectory ? ' dir' : '')
    li.dataset.name = item.name
    if (item.isDirectory) li.dataset.dir = '1'

    const glyph = document.createElement('span')
    glyph.className = 'glyph'
    glyph.textContent = item.isDirectory ? '📁' : '📄'

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = item.name

    const meta = document.createElement('span')
    meta.className = 'meta'
    const bits = []
    if (item.isCloudPlaceholder) bits.push('cloud')
    if (item.metadataUnavailable) bits.push('unavailable')
    else if (!item.isDirectory) bits.push(formatSize(item.size))
    meta.textContent = bits.join(' · ')

    li.append(glyph, name, meta)
    list.append(li)
  }

  el.content.append(list)
}

async function open(dirPath, { push = true } = {}) {
  if (!window.finder) {
    el.content.innerHTML = '<p class="error">The application bridge is unavailable.</p>'
    return
  }
  const result = await window.finder.listDirectory(dirPath)
  if (push && current !== null) history.push(current)
  current = dirPath
  el.path.textContent = dirPath
  el.back.disabled = history.length === 0
  renderItems(result)
}

el.content.addEventListener('dblclick', (event) => {
  const row = event.target.closest('.row')
  if (!row || !row.dataset.dir) return
  const sep = current.includes('\\') ? '\\' : '/'
  const next = current.endsWith(sep) ? current + row.dataset.name : current + sep + row.dataset.name
  open(next)
})

el.back.addEventListener('click', () => {
  const previous = history.pop()
  if (previous !== undefined) open(previous, { push: false })
})

el.up.addEventListener('click', () => {
  const sep = current.includes('\\') ? '\\' : '/'
  const trimmed = current.replace(/[\\/]+$/, '')
  const idx = trimmed.lastIndexOf(sep)
  if (idx > 0) open(trimmed.slice(0, idx))
})

// First paint: the main process names the folder to open (the user's home).
;(async () => {
  if (!window.finder) {
    el.content.innerHTML = '<p class="error">The application bridge is unavailable.</p>'
    return
  }
  const start = await window.finder.startFolder()
  open(start)
})()
