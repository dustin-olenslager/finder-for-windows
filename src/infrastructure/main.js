'use strict'

/**
 * Composition root — the one place where ports meet their adapters.
 *
 * Clean Architecture: this file lives in Frameworks & Drivers. It is the only
 * module allowed to know both a port and its concrete adapter. Nothing inward of
 * it may import Electron, Node's fs, or any vendor module.
 */

const { app, BrowserWindow, ipcMain, shell, clipboard, screen, dialog } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { listDirectory } = require('../application/list-directory')
const { getSidebar } = require('../application/get-sidebar')
const { getPreview } = require('../application/get-preview')
const { performFileOperation } = require('../application/file-operations')
const { transferFiles, dropFiles } = require('../application/transfer-files')
const { createFolderWatcher } = require('./folder-watcher')
const { createIndexBuilder } = require('../application/build-index')
const { searchIndex } = require('../application/search-index')
const { createTagService } = require('../application/tags')
const { createFsDirectoryReader } = require('../adapters/fs-directory-reader')
const { createFsFileReader } = require('../adapters/fs-file-reader')
const { createFsFileOperations } = require('../adapters/fs-file-operations')
const { createFsIndexWalker } = require('../adapters/fs-index-walker')
const { createJsonIndexStore } = require('../adapters/json-index-store')
const { createElectronKnownFolders } = require('../adapters/electron-known-folders')
const { createWindowsDrives } = require('../adapters/windows-drives')
const { createFileIconProvider } = require('../adapters/electron-file-icons')
const { createWindowState, isVisibleOn } = require('./window-state')
const { normalizePath, parentOf, joinPath, segments } = require('../domain/paths')

/** `execFile` as a promise with a hard timeout, so no drive can hang the UI. */
function exec(command, args, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout) })
    })
  })
}

/** Build the wired-up use cases for this process. */
function createContainer({ fileIcons }) {
  const directoryReader = createFsDirectoryReader()
  const fileReader = createFsFileReader()
  // Electron's shell.trashItem is the only supported route to the Windows Recycle Bin,
  // so it is injected here rather than imported by the adapter (which stays Electron-free).
  const fileOperations = createFsFileOperations({ trash: (p) => shell.trashItem(p) })
  const knownFolders = createElectronKnownFolders({
    app,
    exists: (p) => {
      try {
        return fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    }
  })
  const drives = createWindowsDrives({ exec, fsModule: fs })

  // Search. The index is a derived artifact: it is rebuilt from the disk at any time
  // and is never the only copy of anything.
  const store = createJsonIndexStore({ dataDir: app.getPath('userData') })
  const indexBuilder = createIndexBuilder({ walker: createFsIndexWalker() })
  const tags = createTagService({ store })
  let lastScan = null

  return {
    // Every path is normalized before it reaches a port: "C:" becomes "C:\", which
    // is the difference between listing the drive root and listing whatever folder
    // the process happens to be sitting in.
    listDirectory: (dirPath) => listDirectory({ directoryReader }, normalizePath(dirPath) ?? dirPath),
    getSidebar: () => getSidebar({ knownFolders, drives }),
    startFolder: () => normalizePath(app.getPath('home')) ?? app.getPath('home'),

    // Path arithmetic is a domain concern, but the renderer cannot require the domain
    // layer — it has no Node access. These three channels are the renderer's only way
    // to build or walk a path, which keeps "C:\" handling in exactly one place.
    joinPath: (dirPath, name) => joinPath(dirPath, name),
    parentPath: (dirPath) => parentOf(dirPath),
    pathSegments: (dirPath) => segments(dirPath),

    getPreview: (filePath, name) => getPreview({ fileReader }, filePath, name),

    /**
     * The OS's own icon for a file type, for the listing to swap in behind its own glyph.
     * Returns { ok, icon } with icon null when the shell has no answer — a normal result,
     * not an error, because the built-in vector glyph is a fine fallback.
     */
    fileIcon: async (target, isDirectory) => ({
      ok: true,
      icon: await fileIcons.forPath(target, isDirectory)
    }),

    /**
     * The drive list is consulted so a mapped network drive can be refused before anything
     * is deleted: those have no Recycle Bin, and Electron deletes them permanently while
     * reporting success. The lookup is best-effort — if it fails, the trash path falls back
     * to the UNC-only rule rather than blocking a legitimate delete.
     */
    performFileOperation: async (request) => {
      let networkRoots = []
      if (request?.op === 'trash') {
        try {
          const listed = await drives.list()
          networkRoots = (listed?.drives ?? listed ?? [])
            .filter((d) => d.kind === 'network')
            .map((d) => d.path)
        } catch {
          networkRoots = []
        }
      }
      return performFileOperation({ fileOperations, networkRoots }, request)
    },
    transfer: (request) => transferFiles({ fileOperations }, request),
    dropFiles: (request) => dropFiles({ fileOperations }, request),

    // ---- search -----------------------------------------------------------
    search: (request) => searchIndex({ store }, request ?? {}),

    indexStatus: async () => {
      const { stats } = await store.read()
      return { ok: true, lastScan, stats: stats ?? null, running: lastScan?.running ?? false }
    },

    /** Walk every fixed drive. Progress is pushed to the renderer as it goes. */
    buildIndex: async (send) => {
      const roots = await drives.list().then(
        (list) => (list.drives ?? list ?? []).filter((d) => d.isReady !== false).map((d) => d.path),
        () => []
      )
      const usable = roots.length > 0 ? roots : [normalizePath('C:\\') ?? 'C:\\']
      lastScan = { running: true, startedAt: Date.now(), roots: usable }

      const state = await store.readState()
      const result = await indexBuilder.run(usable, {
        exclusions: new Set(state.exclusions ?? []),
        onProgress: (progress) => {
          lastScan = { ...lastScan, ...progress }
          if (typeof send === 'function') send(progress)
        }
      })

      await store.write(result.records, result.stats)
      lastScan = { ...lastScan, running: false, done: true, ...result.stats }

      // Tags whose file is gone are dropped, so the store cannot grow forever.
      const existing = new Set(result.records.map((r) => r.path.toLowerCase()))
      const pruned = await tags.prune(existing)

      return { ok: true, stats: result.stats, pruned }
    },

    cancelIndex: () => {
      indexBuilder.cancel()
      return { ok: true }
    },

    // ---- tags -------------------------------------------------------------
    listTags: () => tags.listAll(),
    tagItem: async (record, tagName) => tags.assign(record, tagName),
    untagItem: async (record, tagName) => tags.remove(record, tagName)
  }
}

function createWindow(remembered) {
  // A remembered position is only used if it is still on a display that exists. Restoring
  // coordinates for a monitor that has been unplugged puts the window off screen, which
  // looks to the user like the app failing to open at all.
  const displays = screen.getAllDisplays()
  const bounds = remembered?.bounds && isVisibleOn(remembered.bounds, displays) ? remembered.bounds : null

  const win = new BrowserWindow({
    width: bounds?.width ?? 1180,
    height: bounds?.height ?? 760,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 720,
    minHeight: 460,
    title: 'Finder for Windows',
    backgroundColor: '#1c1c1e',
    show: false,
    // macOS-style chrome: hide the OS title bar so the toolbar is the top of the
    // window, while the native window controls stay usable in the overlay.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#98989d', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  // Links never navigate the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.whenReady().then(async () => {
  // The shell-icon provider lives at this scope, not inside createContainer, because it is
  // the IPC boundary that calls it — the same reason `watcher` is built here. It is passed
  // INTO the container so the composition root wires it like every other adapter.
  const fileIcons = createFileIconProvider({ app })
  const container = createContainer({ fileIcons })
  const watcher = createFolderWatcher(() => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) win.webContents.send('folders-changed')
  })

  // The IPC boundary. The renderer never touches the filesystem: it calls these
  // channels, which delegate to a use case, which depends only on a port.
  ipcMain.handle('list-directory', (_event, dirPath) => container.listDirectory(dirPath))
  ipcMain.handle('get-sidebar', () => container.getSidebar())
  ipcMain.handle('start-folder', () => container.startFolder())
  ipcMain.handle('join-path', (_event, dirPath, name) => container.joinPath(dirPath, name))
  ipcMain.handle('parent-path', (_event, dirPath) => container.parentPath(dirPath))
  ipcMain.handle('path-segments', (_event, dirPath) => container.pathSegments(dirPath))
  ipcMain.handle('get-preview', (_event, filePath, name) => container.getPreview(filePath, name))
  ipcMain.handle('file-operation', (_event, request) => container.performFileOperation(request))
  // The renderer says which folders are on screen; the main process watches exactly those
  // and pushes a single 'folders-changed' event when one of them moves.
  ipcMain.handle('watch-folders', (_event, paths) => {
    watcher.set(paths)
    return { ok: true, watching: (paths || []).length }
  })
  ipcMain.handle('transfer', (_event, request) => container.transfer(request))
  ipcMain.handle('drop-files', (_event, request) => container.dropFiles(request))

  // Search. The scan pushes progress to the window that asked for it, so the UI can
  // show coverage while it runs instead of a spinner with no information in it.
  ipcMain.handle('search', (_event, request) => container.search(request))
  ipcMain.handle('index-status', () => container.indexStatus())
  ipcMain.handle('build-index', (event) =>
    container.buildIndex((progress) => {
      // The window can close mid-scan. `event.sender` is also absent when the handler is
      // invoked without a real webContents (a test, or a stale caller), so both are
      // checked rather than assuming the sender is there.
      const sender = event?.sender
      if (sender && !sender.isDestroyed()) sender.send('index-progress', progress)
    })
  )
  ipcMain.handle('cancel-index', () => container.cancelIndex())
  ipcMain.handle('list-tags', () => container.listTags())
  ipcMain.handle('tag-item', (_event, record, tagName) => container.tagItem(record, tagName))
  ipcMain.handle('untag-item', (_event, record, tagName) => container.untagItem(record, tagName))

  // Clipboard. Electron's module is the canonical route and needs no permission grant.
  ipcMain.handle('copy-text', (_event, text) => {
    const value = typeof text === 'string' ? text : String(text ?? '')
    if (value === '') return { ok: false, error: 'Nothing to copy.' }
    clipboard.writeText(value)
    // Read back rather than assume: the renderer reports success, and it must be true.
    return { ok: clipboard.readText() === value, value }
  })

  // Interface size. `setZoomFactor` is Chromium's own page zoom: it scales the whole
  // interface — text, rows, columns, padding, images — in one call. Changing the root
  // font size instead did nothing, because every size in the stylesheet is in px.
  ipcMain.handle('set-zoom', (event, factor) => {
    const scale = Number(factor)
    if (!Number.isFinite(scale) || scale < 0.5 || scale > 3) {
      return { ok: false, error: 'Unsupported scale.' }
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'No window.' }
    win.webContents.setZoomFactor(scale)
    // Read back what the engine actually holds, so "applied" is a fact and not a hope.
    return { ok: true, factor: win.webContents.getZoomFactor() }
  })
  /**
   * The OS's own icon for a file type.
   *
   * One handler, called with a SAMPLE path per file type, and cached on both sides: the
   * adapter caches by extension, so the shell is asked once per type rather than once per
   * file. Returns null when the shell has no answer, which is not an error.
   */
  ipcMain.handle('file-icon', (_event, target, isDirectory) =>
    container.fileIcon(target, Boolean(isDirectory))
  )

  ipcMain.handle('reveal-in-explorer', (_event, target) => {
    shell.showItemInFolder(target)
    return { ok: true }
  })
  ipcMain.handle('open-with-default', async (_event, target) => {
    const error = await shell.openPath(target)
    return error ? { ok: false, error } : { ok: true }
  })

  const windowState = createWindowState({
    dataDir: app.getPath('userData'),
    defaultWidth: 1180,
    defaultHeight: 760,
    minWidth: 720,
    minHeight: 460
  })
  const remembered = await windowState.read()

  const mainWindow = createWindow(remembered)
  windowState.track(mainWindow)
  // Maximizing is restored AFTER the window is ready: doing it during construction on
  // Windows can produce a window that is maximized but reports the restored bounds.
  if (remembered?.maximized) mainWindow.once('ready-to-show', () => mainWindow.maximize())
  mainWindow.on('closed', () => watcher.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
// Anything that throws while starting up is otherwise SILENT: the installer reports only that
// Finish failed, and the user is left with an empty screen and no reason. This surfaced as
// "Windows is searching for Finder for Windows.exe" on a perfectly good install — the failure
// that mattered was nowhere in the app, and finding it took reading electron-builder's NSIS
// templates. So a startup fault now names itself, on screen and on stderr.
  .catch((error) => {
    const detail = error && error.stack ? error.stack : String(error)
    process.stderr.write(`Finder for Windows failed to start:\n${detail}\n`)
    dialog.showErrorBox(
      'Finder for Windows could not start',
      `${(error && error.message) || error}\n\n${detail}`
    )
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
