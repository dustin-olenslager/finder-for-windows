'use strict'

/**
 * Use case: GetSidebar
 *
 * Assembles the sidebar's sections. The renderer never learns where a Favorites
 * entry came from; it gets one flat, ordered shape.
 *
 * Ports used: KnownFolders (Favorites) and Drives (Locations).
 */

/**
 * @param {{ knownFolders: { list: () => Promise<object[]> }, drives: { list: () => Promise<object[]> } }} deps
 */
async function getSidebar({ knownFolders, drives }) {
  const [favorites, locations] = await Promise.all([
    safeList(knownFolders),
    safeList(drives)
  ])

  return {
    ok: true,
    sections: [
      {
        id: 'favorites',
        title: 'Favorites',
        items: favorites.filter((f) => f.path).map((f) => ({
          id: f.id,
          label: f.label,
          path: f.path,
          icon: f.kind === 'home' ? 'home' : 'folder'
        }))
      },
      {
        id: 'tags',
        title: 'Tags',
        // The tag store lands with M5. The section exists now so the sidebar shape is
        // final and a later milestone fills it rather than restructuring the UI.
        items: []
      },
      {
        id: 'locations',
        title: 'Locations',
        items: locations.map((d) => ({
          id: d.path,
          label: d.label,
          path: d.path,
          icon: d.kind === 'network' ? 'network' : d.isRemovable ? 'removable' : 'drive'
        }))
      }
    ]
  }
}

async function safeList(port) {
  try {
    const list = await port.list()
    return Array.isArray(list) ? list : []
  } catch {
    // A sidebar section that cannot be read shows nothing rather than failing the
    // whole window. The user still has navigation.
    return []
  }
}

module.exports = { getSidebar }
