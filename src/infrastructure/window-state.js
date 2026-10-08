'use strict'

/**
 * Infrastructure: remember the window's size and position between runs.
 *
 * The trap in this feature is not saving — it is RESTORING. A saved position is a pair of
 * coordinates on a display that may no longer exist: unplug the second monitor, and a
 * window that reopens at x=2600 is off screen, which to the user looks exactly like the app
 * failing to start. So the saved bounds are validated against the displays that exist now,
 * and anything that would land outside them is discarded in favour of the default size.
 *
 * Only `bounds` and `maximized` live here. Window chrome is not application state, and
 * putting it in the index store (which holds tags and saved searches) would mix two
 * concerns that change for entirely different reasons.
 */

const fs = require('node:fs')
const path = require('node:path')

/** How much of the window must be on a display for the position to be usable. */
const MIN_VISIBLE = 0.25

/**
 * Is this rectangle meaningfully on any of these displays?
 *
 * Deliberately not "fully inside": a window half off the edge of a screen is a normal thing
 * to have arranged, and refusing to restore it would be its own annoyance. The test is that
 * a usable part of the TITLE BAR area is reachable — if you can grab it, you can move it.
 */
function isVisibleOn(bounds, displays) {
  if (!bounds || !Array.isArray(displays) || displays.length === 0) return false
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((n) => Number.isFinite(n))) return false
  if (bounds.width <= 0 || bounds.height <= 0) return false

  const titleBarHeight = Math.min(40, Math.max(10, Math.round(bounds.height * 0.1)))
  const bar = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: titleBarHeight
  }

  return displays.some((display) => {
    const area = display?.workArea
    if (!area) return false
    const overlapX = Math.max(0, Math.min(bar.x + bar.width, area.x + area.width) - Math.max(bar.x, area.x))
    const overlapY = Math.max(0, Math.min(bar.y + bar.height, area.y + area.height) - Math.max(bar.y, area.y))
    const overlap = overlapX * overlapY
    return overlap >= bar.width * bar.height * MIN_VISIBLE
  })
}

/**
 * Clamp a saved size to something sane, keeping the position to be validated separately.
 * A window restored at 20px wide is a window the user has to fix before they can use it.
 */
function normalizeSize(bounds, { defaultWidth, defaultHeight, minWidth, minHeight }) {
  if (!bounds) return null
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(minWidth, Math.min(defaultWidth * 4, Math.round(bounds.width))),
    height: Math.max(minHeight, Math.min(defaultHeight * 4, Math.round(bounds.height)))
  }
}

function createWindowState({ dataDir, defaultWidth, defaultHeight, minWidth, minHeight }) {
  const file = path.join(dataDir, 'window-state.json')
  let writeTimer = null

  async function read() {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      const size = normalizeSize(saved?.bounds, { defaultWidth, defaultHeight, minWidth, minHeight })
      return { ...saved, bounds: size }
    } catch {
      // No saved state, or unreadable: the defaults are a perfectly good window.
      return null
    }
  }

  async function write(state) {
    try {
      await fs.mkdir(dataDir, { recursive: true })
      const temp = `${file}.tmp`
      await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8')
      // Written to a temp file and renamed, so a crash mid-write cannot leave a truncated
      // JSON file that would make the next launch fall back to the default size forever.
      await fs.rename(temp, file)
    } catch {
      // Remembering the window size is a convenience. Failing to remember it must never
      // interrupt anything, so this is the one place in the app where an error is silent.
    }
  }

  return {
    file,
    read,
    write,

    /** Save the window's geometry. Debounced: a drag emits a continuous stream of events. */
    remember(win) {
      clearTimeout(writeTimer)
      writeTimer = setTimeout(() => {
        if (win.isDestroyed()) return
        // A maximized window's bounds are the screen's, so saving them would lose the size
        // the user chose before maximizing. The restored size is the one underneath.
        const bounds = typeof win.getNormalBounds === 'function' && win.isMaximized()
          ? win.getNormalBounds()
          : win.getBounds()
        write({ bounds, maximized: win.isMaximized() }).catch(() => {})
      }, 400)
    },

    /** Start remembering this window. Called once, after it exists. */
    track(win) {
      for (const event of ['resize', 'move', 'maximize', 'unmaximize']) {
        win.on(event, () => this.remember(win))
      }
      win.on('close', () => {
        // On close the debounce would never fire, so this one writes immediately.
        clearTimeout(writeTimer)
        if (win.isDestroyed()) return
        const bounds = typeof win.getNormalBounds === 'function' && win.isMaximized()
          ? win.getNormalBounds()
          : win.getBounds()
        return write({ bounds, maximized: win.isMaximized() })
      })
      return win
    }
  }
}

module.exports = { createWindowState, isVisibleOn, normalizeSize, MIN_VISIBLE }
