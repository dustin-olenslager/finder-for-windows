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

  /** The folder to open on first paint (the user's home directory). */
  startFolder: () => ipcRenderer.invoke('start-folder')
})
