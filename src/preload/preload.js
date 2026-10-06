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

  /** How an item can be previewed, and the payload for the kinds we render inline. */
  getPreview: (filePath, name) => ipcRenderer.invoke('get-preview', filePath, name),

  /** create-folder | rename | trash. Resolves to { ok } or { ok:false, error }. */
  fileOperation: (request) => ipcRenderer.invoke('file-operation', request),

  /** Escape hatch: show the item in Windows Explorer. */
  revealInExplorer: (target) => ipcRenderer.invoke('reveal-in-explorer', target),

  /** Open an item with the Windows default application. */
  openWithDefault: (target) => ipcRenderer.invoke('open-with-default', target),

  // ---- search -------------------------------------------------------------

  /** Search the index. { text, scope: 'folder'|'everywhere', folder } */
  search: (request) => ipcRenderer.invoke('search', request),

  /** Whether the index exists, and what the last scan covered. */
  indexStatus: () => ipcRenderer.invoke('index-status'),

  /** Walk the drives and build the index. Long-running; resolves at the end. */
  buildIndex: () => ipcRenderer.invoke('build-index'),

  /** Ask a running scan to stop. It stops between folders, not mid-file. */
  cancelIndex: () => ipcRenderer.invoke('cancel-index'),

  /**
   * Scan progress. Returns an unsubscribe function so a caller can stop listening —
   * the preload never hands the renderer the raw ipcRenderer.
   */
  onIndexProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('index-progress', listener)
    return () => ipcRenderer.removeListener('index-progress', listener)
  },

  // ---- tags ---------------------------------------------------------------

  /** Every tag and the files carrying it. */
  listTags: () => ipcRenderer.invoke('list-tags'),

  /** Attach a tag to a file. The record's path+size+mtime identify it. */
  tagItem: (record, tagName) => ipcRenderer.invoke('tag-item', record, tagName),

  /** Remove one tag from a file. */
  untagItem: (record, tagName) => ipcRenderer.invoke('untag-item', record, tagName)
})
