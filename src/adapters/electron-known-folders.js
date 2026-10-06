'use strict'

/**
 * Adapter: ElectronKnownFolders — implements the KnownFolders port.
 *
 * Layers: Interface Adapters. The ONLY place that knows Electron's app.getPath.
 * `app` is injected rather than required so this file is testable without Electron.
 *
 * `kind` drives the sidebar icon: 'home' | 'folder' | 'drive'.
 */

const CANDIDATES = [
  { id: 'home', label: 'Home', key: 'home', kind: 'home' },
  { id: 'desktop', label: 'Desktop', key: 'desktop', kind: 'folder' },
  { id: 'documents', label: 'Documents', key: 'documents', kind: 'folder' },
  { id: 'downloads', label: 'Downloads', key: 'downloads', kind: 'folder' },
  { id: 'pictures', label: 'Pictures', key: 'pictures', kind: 'folder' },
  { id: 'music', label: 'Music', key: 'music', kind: 'folder' },
  { id: 'videos', label: 'Videos', key: 'videos', kind: 'folder' },
  { id: 'temp', label: 'Temporary', key: 'temp', kind: 'folder' }
]

/**
 * @param {{ app: { getPath: (k: string) => string } , exists?: (p: string) => boolean }} deps
 */
function createElectronKnownFolders({ app, exists }) {
  return {
    async list() {
      const out = []
      for (const candidate of CANDIDATES) {
        let path = null
        try {
          path = app.getPath(candidate.key)
        } catch {
          path = null // this platform has no such folder
        }
        if (path && exists && !exists(path)) path = null
        out.push({ id: candidate.id, label: candidate.label, path, kind: candidate.kind })
      }
      return out
    }
  }
}

module.exports = { createElectronKnownFolders, CANDIDATES }
