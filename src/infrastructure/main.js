'use strict'

/**
 * Composition root — the one place where ports meet their adapters.
 *
 * Clean Architecture: this file lives in Frameworks & Drivers. It is the only
 * module allowed to know both a port and its concrete adapter. Nothing inward of
 * it may import Electron, Node's fs, or any vendor module.
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const { listDirectory } = require('../application/list-directory')
const { createFsDirectoryReader } = require('../adapters/fs-directory-reader')

/** Build the wired-up use cases for this process. */
function createContainer() {
  const directoryReader = createFsDirectoryReader()
  return {
    listDirectory: (dirPath) => listDirectory({ directoryReader }, dirPath)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 420,
    title: 'Finder for Windows',
    backgroundColor: '#1c1c1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

app.whenReady().then(() => {
  const container = createContainer()

  // The IPC boundary. The renderer never touches the filesystem: it calls these
  // channels, which delegate to a use case, which depends only on a port.
  ipcMain.handle('list-directory', (_event, dirPath) => container.listDirectory(dirPath))
  ipcMain.handle('start-folder', () => app.getPath('home'))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
