'use strict'

/**
 * Preload — the only bridge between the renderer and the main process.
 *
 * contextIsolation is on and nodeIntegration is off, so the renderer has no Node
 * API at all. This file exposes a narrow, named surface; nothing else crosses.
 * Every method here maps to exactly one IPC channel handled in the composition root.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('finder', {
  /**
   * List a folder. Resolves to { ok, path, items } or { ok:false, path, error }.
   * Never rejects across the boundary — the renderer renders the error string.
   */
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),

  /** The sidebar's three sections: Favorites, Tags (empty until M5), Locations. */
  getSidebar: () => ipcRenderer.invoke('get-sidebar'),

  /** The folder to open on first paint (the user's home directory). */
  startFolder: () => ipcRenderer.invoke('start-folder'),

  /**
   * Path arithmetic lives in the main process (src/domain/paths.js) so the renderer
   * never guesses at separators. "C:" is drive-RELATIVE on Windows; only the domain
   * layer knows that.
   */
  joinPath: (dirPath, name) => ipcRenderer.invoke('join-path', dirPath, name),

  /** The enclosing folder, or null at a root. */
  parentPath: (dirPath) => ipcRenderer.invoke('parent-path', dirPath),

  /** Breadcrumb segments for a path. */
  pathSegments: (dirPath) => ipcRenderer.invoke('path-segments', dirPath),

  /** Escape hatch: show the item in Windows Explorer. */
  revealInExplorer: (target) => ipcRenderer.invoke('reveal-in-explorer', target),

  /** Open an item with the Windows default application. */
  openWithDefault: (target) => ipcRenderer.invoke('open-with-default', target)
})
