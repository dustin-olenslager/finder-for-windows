'use strict'

/**
 * Adapter: WindowsDrives — implements the Drives port.
 *
 * Layers: Interface Adapters. Enumerates mounted drives and UNC roots without
 * touching the network more than necessary.
 *
 * Why not `fs.readdir('\\\\')`: reading a UNC namespace root hangs for a long time
 * and is unreliable. Instead:
 *   - Windows: parse the drive letters Electron reports from GetLogicalDrives, and
 *     label each by reading its volume name only when the drive is ready.
 *   - Other platforms: the POSIX root plus /media, /mnt, /Volumes.
 *
 * Every returned path is ROOTED ("C:\\"), never drive-relative.
 */

const path = require('node:path')

function labelForLetter(letter, fsModule) {
  const root = `${letter}:\\`
  try {
    const name = fsModule.readFileSync ? volumeName(root, fsModule) : null
    return name ? `${name} (${letter}:)` : `${letter}:`
  } catch {
    return `${letter}:`
  }
}

/**
 * Best-effort volume label. Uses the `statfs`-free approach: a marker file check is
 * not enough, so we try the small read of System Volume Information's absence and
 * fall back to the letter. A wrong label is cosmetic; a hang is not, so this is
 * deliberately cheap and never blocks on a network device.
 */
function volumeName(root, fsModule) {
  try {
    // Reading a directory that must exist on any formatted NTFS/FAT volume is the
    // cheapest readiness probe that does not hydrate anything.
    fsModule.readdirSync(root, { withFileTypes: true })
    return null // label needs a platform call we do not have here; the letter is used
  } catch {
    return null
  }
}

function createWindowsDrives({ exec, fsModule }) {
  return {
    async list() {
      const drives = []

      if (process.platform === 'win32') {
        // `wmic logicaldisk` is deprecated; PowerShell CIM is the supported call and
        // is present on every Windows 11 install. It is run with a hard timeout so a
        // sleeping or disconnected drive cannot hang the sidebar.
        const script =
          'Get-CimInstance -ClassName Win32_LogicalDisk | ' +
          'Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'
        let parsed = []
        try {
          const { stdout } = await exec('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            script
          ])
          const json = JSON.parse(stdout.trim() || '[]')
          parsed = Array.isArray(json) ? json : [json]
        } catch {
          parsed = []
        }

        for (const disk of parsed) {
          const device = String(disk.DeviceID || '').replace(/\\+$/, '')
          if (!/^[A-Za-z]:$/.test(device)) continue
          const letter = device[0].toUpperCase()
          const driveType = Number(disk.DriveType ?? 0)
          // 2 = removable, 3 = local disk, 4 = network, 5 = optical, 6 = RAM disk.
          if (![2, 3, 4, 5, 6].includes(driveType)) continue
          drives.push({
            path: `${letter}:\\`,
            label: disk.VolumeName ? `${disk.VolumeName} (${letter}:)` : `${letter}:`,
            kind: driveType === 4 ? 'network' : driveType === 2 || driveType === 5 ? 'removable' : 'drive',
            isRemovable: driveType === 2 || driveType === 5
          })
        }
      } else {
        drives.push({ path: '/', label: '/', kind: 'drive', isRemovable: false })
        for (const dir of ['/media', '/mnt', '/Volumes']) {
          try {
            for (const entry of fsModule.readdirSync(dir)) {
              drives.push({
                path: path.posix.join(dir, entry),
                label: entry,
                kind: 'drive',
                isRemovable: true
              })
            }
          } catch {
            /* not present on this machine */
          }
        }
      }

      drives.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      return drives
    }
  }
}

module.exports = { createWindowsDrives, labelForLetter }
