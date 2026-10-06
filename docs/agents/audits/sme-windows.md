# SME Windows — how native does this feel, and what to build last

Repo: `/opt/data/repos/finder-for-windows` @ v0.13.0, Electron pinned `^43.2.0` (installed **43.7.7**).
Read-only audit. No file under the repo was modified.

Evidence basis: greps against `src/`, the installed `node_modules/electron/electron.d.ts` (43.7.7),
`electron-builder.yml`, the spec/decision log, plus a live render of the real renderer through the
stub bridge (`scripts/build-preview.py` → Playwright probe). `npm test` = **137 pass / 0 fail**.

Legend: **VERIFIED-ABSENT** = grepped the source and it is not there. **ASSUMED-MISSING** = no direct
evidence either way (could not execute on Windows).

---

## 1. FINDINGS

### F1 — You cannot drag a file out of this app. (VERIFIED-ABSENT) — worst offender
**What the user feels:** select three photos, drag them onto a browser upload box, an email, or an
Explorer window — nothing happens. The cursor never picks anything up. Every other file manager on
Windows does this, so the app reads as a web page wearing a window frame.

**Evidence:**
- `grep -rni "drag\|dragstart\|dragover\|drop\|draggable\|startDrag" src/` returns only CSS
  `-webkit-app-region: drag` (title bar chrome: `src/renderer/style.css:73,119,315`) and comments.
  Zero `dragstart`, zero `dataTransfer`, zero `webContents.startDrag`.
- Renderer probe (real `app.js` against the stub bridge): rows are
  `<div class="row is-dir" data-name="Desktop" data-dir="1" role="option">` — `draggable` is `false`
  on all 11 rows; no `dragstart` listener exists.
- The preload surface (`src/preload/preload.js:13-126`, 21 keys) has no drag method at all.
- Confirmed in the bridge dump: keys are `listDirectory, getSidebar, startFolder, joinPath,
  parentPath, pathSegments, getPreview, fileOperation, transfer, copyText, setZoom, revealInExplorer,
  openWithDefault, indexStatus, buildIndex, cancelIndex, onIndexProgress, watchFolders,
  onFoldersChanged, listTags, tagItem, untagItem`. No `startDrag`, no `getPathForFile`.

**The API that fixes it:** `webContents.startDrag(item)` — **available in the installed 43.7.7**,
proven by `node_modules/electron/electron.d.ts:18714` and the `Item` interface at `:22233`
(`{ file: string; files?: string[]; icon: NativeImage|string }`).
Needs: `preload` exposes `startDrag(paths: string[])` → `ipcRenderer.invoke('start-drag', paths)`;
`main.js` handles it with `BrowserWindow.fromWebContents(event.sender).webContents.startDrag({ files, icon })`.
`icon` must be a real `NativeImage` — see F5, since there is no native icon source today.

### F2 — You cannot drag a file into this app, onto a folder, or onto a sidebar row. (VERIFIED-ABSENT)
**What the user feels:** drag a file from Explorer onto a folder in this window → the OS shows "no"
cursor; the window does not accept it. Also unmet: **FR-003** ("drag a file onto a sidebar row and
have it moved or copied") is a hard spec requirement with zero implementation.

**Evidence:** same grep as F1 — no `dragover`, no `drop`, no `dragenter`, no `dragleave` anywhere in
`src/renderer/app.js` (3295 lines) or `src/renderer/index.html`. The renderer's only listeners are
`click`, `dblclick`, `contextmenu`, `keydown`, `input`, `change`, `mouseenter` (listener census via
`grep -on "addEventListener('[a-z]*'" src/renderer/app.js`).
`src/application/transfer-files.js` exists and already handles copy/move correctly — the missing piece
is purely the drop plumbing.

**The API that fixes it:** the renderer `drop`/`dragover` events plus `webUtils.getPathForFile(file)`
(**available at 43**: `electron.d.ts:19900`). `webUtils` is a renderer module and with
`sandbox: true` it must be re-exported by the preload.
Needs: `preload` exposes `pathForFile(file) => webUtils.getPathForFile(file)`; `app.js` adds
`dragover` (preventDefault) + `drop` on `.row`/`.icon-cell`/`.sidebar-item`/`.content` background,
calls the existing `window.finder.transfer({ op, items, destination })`.

### F3 — Copy here does not paste in Explorer; copy in Explorer does not paste here. (VERIFIED-ABSENT, and BLOCKED at the pinned version)
**What the user feels:** Ctrl+C a file here, switch to Explorer, Ctrl+V → nothing. And the reverse:
copy a file in Explorer, come back here, Ctrl+V → "Nothing has been copied yet."

**Evidence:**
- The file clipboard is deliberately app-local: `src/renderer/app.js:2556-2560` —
  *"Deliberately NOT the system clipboard: Windows' own file clipboard needs CF_HDROP…"*;
  `state.clipboard` is a plain JS object (`src/renderer/app.js:86-87`).
- The only system-clipboard route is text: `ipcMain.handle('copy-text', …)` →
  `clipboard.writeText(value)` (`src/infrastructure/main.js:214-220`).

**Version answer (explicit, as asked): the pinned version CANNOT do it. Electron 44 is required.**
- In the installed 43.7.7 typings, `clipboard.read(format): string` (`:6965`),
  `clipboard.write(data: Data): void` (`:7012`), and the `Data` interface (`:21545`) is exactly
  `{ text?, html?, image?, rtf?, bookmark? }`. There is **no `ClipboardItem` class** in 43
  (`grep -n "ClipboardItem" node_modules/electron/electron.d.ts` → no match).
- `text/uri-list` ↔ CF_HDROP landed with upstream #51707, shipped in **Electron 44.0.0**
  (release notes list *"clipboard module is now aligned with the W3C Clipboard API #52508"*;
  the v44 `clipboard-item.md` states: *"The text/uri-list MIME type is mapped to the operating
  system's native 'copied files' clipboard format (CF_HDROP on Windows …)"*).
- 43.7.7 is also on the 43 line, so no backport is in the installed tree.

**The API:** `clipboard.write([new ClipboardItem({ 'text/uri-list': fileUrls.join('\r\n') })])` and
`await clipboard.read()` → `item.getType('text/uri-list')`, both **main process**, v44+.
Needs: bump `electron` to `^44` (breaking change: clipboard is no longer exposed to renderers — this
app already keeps it in main, so the blast radius is small); `main.js` adds `write-files` / `read-files`
handlers using `pathToFileURL`; `preload` exposes `copyFiles(paths)` / `readClipboardFiles()`.
Note the fallback already shipped is honest and should stay until then: `copySelection()` writes paths
as *text* (`copyText`), and the README's stated scope is that the app never touches Explorer settings.

### F4 — Every row shows the same generic page glyph; no real icons, no thumbnails. (VERIFIED-ABSENT)
**What the user feels:** a folder of PDFs, .exe files, Word docs and a .mp4 all render as the same
outline drawing in 4–6 hand-rolled variants. It is the single loudest "this is not Windows" signal,
and it is also an unmet spec requirement (**FR-038**: thumbnails for images/video in icon and gallery
views).

**Evidence:**
- `grep -rn "getFileIcon\|createThumbnailFromPath\|nativeImage" src/` → **no matches**. The only
  `nativeImage` hit anywhere is in `electron.d.ts`.
- `grep -rni "thumbnail" src/` → **no matches**.
- The icon set is an inline SVG map: `SVG` object starting `src/renderer/app.js:129` (`folder`, `file`,
  `home`, `drive`, `network`, `removable`, then image/video/audio/pdf/code/archive/…), consumed by
  `iconFor(item)` at `:162` and inlined with `glyph.innerHTML = iconFor(item)` (`:437, :527, :824,
  :909, :1156`).
- `src/domain/file-kind.js` classifies by extension only; nothing asks the shell.

**The API:** `app.getFileIcon(path, { size: 'normal'|'large' }) → Promise<NativeImage>`
(`electron.d.ts:1189`, main process) and `nativeImage.createThumbnailFromPath(path, size)`
(`electron.d.ts:9967`, main process; Windows/macOS only).
Needs: `main.js` handler `get-icon(path)` returning `image.toDataURL()`; `preload` exposes
`getFileIcon(path)`; `app.js` swaps `iconFor()` for a cached `getFileIcon()` result per extension in
icon/gallery/list views. Cache by extension, not by path, or a 100k-entry folder (FR-025) becomes
100k `NativeImage`s. **Never call this for `isCloudPlaceholder` items** — that would hydrate a
OneDrive/Drive placeholder, violating FR-027.

### F5 — No undo, and no Put Back from the Recycle Bin. (VERIFIED-ABSENT)
**What the user feels:** Delete sends a file to the Recycle Bin and there is no Ctrl+Z. An accidental
Delete on a selection of five is unrecoverable inside the app. Unmet: **FR-019** (Put Back) and
**FR-020** (journal + undo the most recent operation, including after a restart).

**Evidence:**
- `grep -rni "undo\|redo" src/` → only `function restore(entry)` (`app.js:1379`) and DOM-restore
  helpers — nothing to do with file operations. No Ctrl+Z / Ctrl+Y branch in the keydown handler
  (`app.js:3122-3257`).
- `grep -rni "journal" src/` → **no matches**, though FR-020 and the spec's "Operation" entity both
  require one. `docs/agents/in-app`-side state (`src/adapters/json-index-store.js:77-83`) has a slot
  for `tags`, `savedSearches`, `exclusions`, `indexingPaused` — no operations array.
- Trash itself is correctly wired: `shell.trashItem` injected at `src/infrastructure/main.js:50`.

**The API:** no Electron API for undo. This is an app-local journal (move/rename/copy/trash with the
pre-op path) written next to the index store. Restoring *from* the Recycle Bin has no supported
Electron route — the shell's Restore verb is only reachable via the `Shell.Application` COM object
(PowerShell `NameSpace(10).Items()` + `InvokeVerb('restore')`) or by reversing `$Recycle.Bin`'s
`$I`/`$R` pairs (undocumented, elevation-sensitive). **Recommendation: implement undo from the journal
(cheap, safe, covers the real accident) and treat Put Back-from-bin as a low-priority item** — see
Deletion candidates.

### F6 — Name collisions are refused, not resolved. (VERIFIED-ABSENT)
**What the user feels:** paste a file where one with that name exists → *"There is already an item
named "x" in that folder."* Windows and Finder both offer Replace / Skip / Keep both. Refusing is
safe but it is the behaviour users hit most often in real file work, and it is an unmet **FR-022**.

**Evidence:** `src/application/transfer-files.js:86-90` — a hard refuse with a sentence. Same in
`src/application/file-operations.js:53-55` and `:78-80`. The helper that would do "Keep both" already
exists and is **dead code**: `suggestUniqueName(base, existingNames)` in `src/domain/file-name.js:76`
— `grep -rn "suggestUniqueName" src/` shows it is only defined and exported, never called.

**The API:** none needed — pure app logic. The conflict dialog is a renderer modal (there is already a
`promptForName` modal at `app.js:1617` to copy the pattern from).

### F7 — No "Open with…", and no file-type association story. (VERIFIED-ABSENT / deliberate)
**What the user feels:** a .psd or a .xyz opens with whatever Windows has registered — correct and
native. But right-click → "Open with…" (choose a program) is missing, and you cannot double-click a
.fwfolder / open the app by handing it a folder.

**Evidence:**
- `openWithDefault` exists and is correct (`main.js:240-243`, `shell.openPath`), wired to Enter,
  double-click and the context menu.
- `grep -rni "openwith\|open with\|OpenAs\|association\|defaultapp" src/` → only the
  `openWithDefault` name. No `OpenAs_RunDLL` call, no `app.setAsDefaultProtocolClient`, no
  `app.setUserTasks`.
- Associations are correctly *out of scope by decision* (FR-035, D-0009): the app must not register
  itself as the default handler. **Do not build association registration.**

**The API:** the OS "Open with" chooser is `rundll32.exe shell32.dll,OpenAs_RunDLL <path>`
(`execFile`, main process). ~10 lines.

### F8 — Long paths (>260 chars) are reported as failures, never worked around. (VERIFIED-ABSENT)
**What the user feels:** a deep `node_modules` or an archive-extracted tree hits "That name is too
long." / "Could not open that folder". Explorer with long-path support on handles these; this app
does not.

**Evidence:**
- `grep -rn '\\\\?\\\\\|longPath\|extended-length' src/` → **no matches**. Nothing ever prefixes a
  path with the extended-length `\\?\` marker.
- The failure is handled honestly but passively: `ENAMETOOLONG → 'That name is too long.'`
  (`src/application/file-operations.js:128-129`), and `MAX_LENGTH = 255` is enforced per *segment*
  (`src/domain/file-name.js:22`). The gap is total path length, not segment length.
- FR-033 asks for the *report*, which exists. It does not ask for the workaround — so this is a
  quality gap, not a spec miss.

**The API:** no Electron API; Node on Windows accepts `\\?\C:\…` (and `\\?\UNC\server\share\…`).
Needs a `toExtendedLengthPath()` in `src/domain/paths.js` applied only when the resolved absolute path
exceeds 260 and the target is not already prefixed. Also note `fs.cp`/`fs.rename` inherit the limit.

### F9 — The window forgets its size and position, and the app cannot be opened *on* a folder. (VERIFIED-ABSENT)
**What the user feels:** resize and move the window, quit, relaunch → back to 1180×760 in the same
spot. And `finder-for-windows.exe C:\Users\me\Photos` from Run/`start`/a shortcut does nothing with
the argument; a second launch opens a *second* window instead of focusing the first.

**Evidence:**
- `grep -rni "getBounds\|setBounds\|windowState" src/` → **no matches**. Bounds are hard-coded at
  `src/infrastructure/main.js:138-156`.
- `grep -rni "process.argv\|second-instance\|requestSingleInstanceLock" src/` → **no matches**.
  `app.on('activate')` (`main.js:248-250`) is the macOS-only path; on Windows it never fires.
- The start folder is always `app.getPath('home')` (`main.js:76`, `container.startFolder`).

**The API:** `app.requestSingleInstanceLock()` + `app.on('second-instance', (e, argv, cwd) => …)`
(`electron.d.ts:717, 1578`), and Electron 44's built-in `windowStatePersistence: true` +
`name` in the `BrowserWindow` constructor (43 has no such option — hand-roll `getBounds()` on
`close` and `setBounds()` on start, persisted beside the index store).
Needs: `main.js` only; the folder argument then flows through the existing `startFolder` channel.

### F10 — No hidden/system-file toggle, no type-ahead, no Properties, no Alt+Enter, no read-only flag. (VERIFIED-ABSENT)
**What the user feels (four small, constant Windows reflexes, all absent):**
- Hidden files: the app *already knows* which items are hidden but gives you no way to see them.
- Type-ahead: type `pho` in a folder and jump to `photo.jpg` — nothing.
- Properties: Alt+Enter / right-click → Properties (size on disk, attributes, security) — nothing.
- Read-only / hidden attribute toggling — nothing.

**Evidence:**
- Hidden is computed and then unused as a filter: `isHidden(attributes, name)` in
  `src/adapters/fs-directory-reader.js:77-80`, carried as `isHidden` on every item (`:181`, `:219`).
  `grep -rni "showhidden\|hidden items" src/renderer/` → **no matches**.
- `grep -rni "typeahead\|type-ahead" src/renderer/app.js` → **no matches**.
- `grep -rni "properties\|Alt+Enter" src/renderer/app.js` → **no matches**; there is no
  `altKey && key === 'Enter'` branch in the keydown handler.
- `grep -rni "readonly\|read-only attribute" src/renderer/app.js` → **no matches**.

**APIs:** hidden toggle = app-local (the data is already there) + `ShowHidden`/`ShowSuperHidden`
would be Explorer settings, which FR-035 forbids touching — keep it app-local.
Type-ahead = renderer only. Properties = `Shell.Application` COM `InvokeVerb('properties')` via
`execFile` (no Electron API); Alt+Enter is the same call. Attributes = `attrib.exe` or
`fs.chmod` (the latter only maps read-only on Windows).

### F11 — No shell/taskbar integration at all: no jump list, no progress bar, no thumbnail toolbar, no overlay icon. (VERIFIED-ABSENT)
**What the user feels:** a multi-gigabyte copy shows a toast sentence and nothing else — no progress,
no cancel, no taskbar bar, and the window looks identical whether it is idle or working. Pinning the
app gives no right-click tasks. Unmet: **FR-021** (progress indication for long copy/move/delete and
the ability to cancel).

**Evidence:**
- `grep -rni "setJumpList\|setProgressBar\|setThumbarButtons\|setOverlayIcon" src/` → **no matches**.
  All four are available in 43 (`electron.d.ts:1785, 3446, 3533, 3422`).
- `transferFiles` (`src/application/transfer-files.js:83-98`) is a synchronous `for` loop with no
  progress callback and no cancellation token — the plumbing to feed a progress bar does not exist
  yet either. `grep -rni "progress" src/renderer/app.js` finds only the *index scan* progress
  (`app.js:3076`), which is a different, already-working feature.
- No `Menu.setApplicationMenu` either: the menu bar is HTML (`index.html:15-20`, `app.js:1916`).

**The APIs:** `win.setProgressBar(fraction)` (`:3446`) and `win.setProgressBar(-1)` to clear;
`app.setJumpList(categories)` (`:1785`); `win.setThumbarButtons([…])` (`:3533`) — needs
`thumbnailToolbarHeight`/`setThumbarButtons` on a visible window; `win.setOverlayIcon(image, desc)`
(`:3422`). All main process.
Needs: a progress event from `transferFiles` (chunked `fs.cp` is not exposed, so this means a
per-item `onProgress` at minimum, and a real byte-level progress only via a manual stream copy), a
`preload` `onTransferProgress` subscription, and main-process calls to the four APIs.

### F12 — "Open in Windows Explorer" cannot open the *folder you are in*. (VERIFIED-ABSENT vs FR-037)
**What the user feels:** you are standing in `D:\Shoots\2026-03` with nothing selected and want the
Explorer escape hatch — the menu item does nothing, because it acts on the *selection*. Right-clicking
a folder and choosing it selects that folder *in its parent*, it does not open it.

**Evidence:** the only handler is `revealSelected()` (`app.js:2067-2071`) →
`revealInExplorer(path)` → `shell.showItemInFolder(target)` (`main.js:236-239`), and it early-returns
when `state.selected` is null. Both menu entries (`app.js:1935`, `:2177`) call it. FR-037 says
*"open the current folder in Windows Explorer"*.

**The API:** `shell.openPath(folderPath)` for "open this folder", `shell.showItemInFolder(path)` for
"reveal this item" — both already imported and already used elsewhere.

### F13 — The Recycle Bin UNC refusal is correct; its *presentation* is a dead end. (VERIFIED-ABSENT of a follow-up path)
**What the user feels:** Delete a file on `\\server\share` and you get a toast:
*"A file on a network location cannot go to the Recycle Bin. Nothing was deleted."* True and safe —
but there is no "delete permanently instead?" offer, so the file simply cannot be deleted from this app.

**Evidence:** the refusal is deliberate and documented (`src/domain/paths.js:127-144`,
`src/application/file-operations.js:96-104`). It is also *correct*: `shell.trashItem` on a UNC path
deletes permanently and reports success — verified against the code comment and the upstream
behaviour it documents. `grep -rni "permanent" src/renderer/` → no follow-up affordance.

**Recommendation:** keep the refusal; add a confirm-and-delete-permanently path in the toast/modal
(`fs.rm`), clearly labelled. No new API.

### F14 — Install experience: correct shape, one unavoidable warning. (ASSUMED-MISSING on the machine)
**What the user feels:** download the .exe, run it, Windows shows *"Windows protected your PC —
Unknown publisher"*; you click *More info → Run anyway*. After that, the install is per-user, no
admin prompt, Start-menu + desktop shortcut, and it uninstalls from Add/Remove Programs.

**Evidence:** `electron-builder.yml:20-45` — targets `nsis` + `portable`, `nsis.oneClick: false`,
`perMachine: false`, `allowElevation: true`, `createDesktopShortcut: true`,
`createStartMenuShortcut: true`, `runAfterFinish: true`, `uninstallDisplayName`. Signing is
deliberately off (D-0008; `electron-builder.yml:24-25`, `.github/workflows/build-windows.yml:52-53`).
Icons exist: `build/icon.ico`, `assets/icon-16…256.png`.
Not verifiable here (no Windows, no Electron on this box) → **ASSUMED-MISSING** for anything beyond
the config: I cannot confirm the SmartScreen prompt count, the uninstaller's cleanliness, or whether
the portable target is used. The config itself is the standard per-user NSIS shape and is right.

---

## 2. RANKED PLAN

Ranked by how much each closes the "feels native" gap, biggest first. Size: S ≈ <1 day,
M ≈ 1–3 days, L ≈ >3 days (single dev).

| # | Fix (one line) | Size | Electron / Windows API | Preload + main needs |
|---|---|---|---|---|
| 1 | Drag files **out** to Explorer and other apps | M | `webContents.startDrag({files, icon})` — in 43 (`d.ts:18714`) | preload `startDrag(paths)`; main handler; `icon` needs F5's `app.getFileIcon` |
| 2 | Accept files **in**: onto a folder row, the listing, and a sidebar row (FR-003) | M | renderer `dragover`/`drop` + `webUtils.getPathForFile` — in 43 (`d.ts:19900`) | preload re-exports `webUtils.pathForFile`; renderer calls existing `transfer()` |
| 3 | Real file-type icons + image/video thumbnails (FR-038) | M | `app.getFileIcon` (`d.ts:1189`), `nativeImage.createThumbnailFromPath` (`d.ts:9967`) | main `get-icon`/`get-thumb` → `toDataURL()`; preload; renderer cache keyed by extension; skip cloud placeholders (FR-027) |
| 4 | Undo the last file operation (FR-020) | M | none — app-local journal beside the index store | main writes/reads the journal; preload `undoLast()` |
| 5 | Files on the **system clipboard** so they paste in Explorer, and vice versa | M | **`clipboard.write([new ClipboardItem({'text/uri-list': …})])` — REQUIRES Electron ≥44** | bump `electron` to `^44`; main `write-files`/`read-files` with `pathToFileURL`; preload `copyFiles`/`readClipboardFiles` |
| 6 | Conflict resolution: Replace / Skip / Keep both (FR-022) | S | none — `suggestUniqueName` is already written and unused (`file-name.js:76`) | renderer modal (copy `promptForName`, `app.js:1617`); `transferFiles` gains an `onConflict` policy |
| 7 | Progress + cancel on long copy/move/delete (FR-021) | L | `win.setProgressBar` (`d.ts:3446`), overlay icon (`:3422`) | `transferFiles` emits per-item (ideally per-byte) progress + an abort token; preload `onTransferProgress`; main drives the taskbar |
| 8 | Single instance + open a folder from the command line | S | `app.requestSingleInstanceLock()` (`d.ts:1578`), `second-instance` (`:717`) | main only; reuse the `start-folder` channel with an argv override |
| 9 | Remember window size/position across launches | S | Electron 44 `windowStatePersistence` (or hand-rolled `getBounds`/`setBounds` on 43) | main only; persist beside the index store |
| 10 | Show hidden/system files toggle (the data is already computed) | S | none — `isHidden` already on every item (`fs-directory-reader.js:181`) | renderer filter + a View menu entry; keep it app-local (FR-035) |
| 11 | Type-ahead: typing letters jumps the selection | S | none | renderer only (`keydown`, `app.js:3122`) |
| 12 | Right-click → "Open with…" | S | `rundll32.exe shell32.dll,OpenAs_RunDLL <path>` | main `execFile`; preload `openWith()` |
| 13 | "Open current folder in Explorer" (FR-037 as written) + "Open" on a folder | S | `shell.openPath(dir)` | main already imports `shell`; preload already has `revealInExplorer` |
| 14 | Jump list tasks (recent folders, New Folder) | S | `app.setJumpList(categories)` (`d.ts:1785`) | main only; refresh after each navigation |
| 15 | Thumbnail toolbar (pause/cancel) + overlay icon for "working" | S | `win.setThumbarButtons` (`d.ts:3533`), `win.setOverlayIcon` (`:3422`) | main only; needs a real `NativeImage` (F5) |
| 16 | Long-path support (>260 chars) via `\\?\` | M | none — Node/Windows extended-length prefix | `src/domain/paths.js` + apply at the fs boundary |
| 17 | Properties dialog (Alt+Enter / context menu) | M | `Shell.Application` COM `InvokeVerb('properties')` via `execFile` | main only; no clean Electron API |
| 18 | Delete-permanently offer after the UNC refusal | S | `fs.rm` | main + the existing toast/modal |
| 19 | Native application menu (`Menu.setApplicationMenu`) | M | `Menu.buildFromTemplate` | main; replaces the HTML menubar — **do last**, the HTML one works and is discoverable |
| 20 | Code-signing the installer (kills the SmartScreen prompt) | M + $ | Azure Trusted Signing / OV–EV cert + `signtool` | CI change; D-0008 is an owner decision to revisit only if it becomes a nuisance |

**Suggested order for the "final platform work" pass:** 1, 2, 3 together (they share the
`NativeImage`/icon work and together they are the difference between "web page" and "file manager"),
then 4, then 5 (which is also the only item that forces a major-version bump), then 6, 10, 11, 8, 9,
12, 13 — all small and independent.

---

## 3. DELETION CANDIDATES

Platform features that are tempting but not worth building. Each names the *reason*, and what is done
instead. (Rejections already on record are listed here too, because a rejection left in a chat thread
leaves no artifact to find.)

| Candidate | Verdict | Reason / what we do instead |
|---|---|---|
| **Register as a default handler / file-type associations** (double-click a folder and it opens here) | **Removed — forbidden** | FR-035 and D-0009: the app must not change any system-wide association. "Open with" (item 12) gives the useful half without the hostile half. |
| **Change Explorer settings** (show hidden files globally, default folder view) | **Removed — forbidden** | FR-035, explicit owner decision. The hidden toggle (item 10) is app-local on purpose. |
| **Put Back *from* the Recycle Bin** (restore a file deleted by Explorer) | **Deferred, not removed** | No supported Electron API; the only routes are the `Shell.Application` COM Restore verb or reversing `$Recycle.Bin`'s undocumented `$I`/`$R` pairs, both elevation-sensitive. **Undo from our own journal (item 4) covers the actual accident** — the file you just deleted here. Revisit only if a real user asks to restore files *Explorer* deleted. |
| **Replacing the HTML menu bar with `Menu.setApplicationMenu`** | **Deferred** | It would gain OS-level behaviour (Alt-key activation, mnemonic underlines) but the HTML bar is already discoverable, keyboard-navigable (`app.js:3126-3143`), and holds state the native menu cannot easily show. Cost is real, benefit is small. Only if the app ever gets a second window. |
| **An in-app Recycle Bin view** | **Removed** | Enumerating the bin requires the COM `Shell.Application NameSpace(10)` dance or parsing `$Recycle.Bin` per volume, both unreliable and per-volume. The OS bin already exists and is one click away. |
| **A Windows Search / `Windows.Storage` integration instead of the owned index** | **Removed — already rejected** | D-0009: Windows Search cannot meet the index budget (FR-029). The owned index ships. |
| **`shell.trashItem` for UNC paths** | **Removed — must stay removed** | It deletes permanently and *reports success*. The refusal is the correct behaviour; the fix is the offer in item 18, not the removal of the guard. |
| **HTTP API + MCP server for the file manager** | **Removed — already parked** | `docs/agents/in-progress.md` Parked table + `roadmap.md` Later: no non-human consumer exists. |
| **macOS build target** | **Removed — already parked** | `roadmap.md` Later: never as a side effect of the Windows work. |
| **Registering `app.setUserTasks` / protocol handlers for "Send to"** | **Removed** | It writes to the OS task list / registry, which is the same class of intrusion as association changes, for a feature nobody asked for. |
| **3D cover-flow Gallery view** | **Removed — already scoped down** | `plan.md:113`: Gallery is kept at basic fidelity; the 3D treatment is explicitly out. |
| **Native Windows context-menu shell extensions (right-click in Explorer → "Open in Finder for Windows")** | **Removed** | A shell extension is a registered COM DLL — an install-time system change, incompatible with FR-035 and with the unsigned-build decision. |

---

## 4. WHAT IS ALREADY GOOD

Named, so the next agent does not rebuild it:

- **Path handling is genuinely Windows-correct and rare.** `src/domain/paths.js` treats `C:` as
  drive-relative and `C:\` as the root (`:42-63`), keeps UNC leading separators through `segments()`
  (`:112-125`) so a breadcrumb cannot rebuild a relative path, and `parentOf` returns `C:\` rather
  than `C:` (`:87-100`). The comment at `:6-15` names the exact bug this prevents. This is the kind of
  thing most cross-platform apps get wrong.
- **The Recycle Bin refusal on UNC is right, and it is documented as a deliberate safety choice**
  (`paths.js:127-144`, `file-operations.js:96-104`) — an honest refusal over a lie that destroys data.
- **Bulk directory enumeration is one PowerShell call per folder** (`fs-directory-reader.js:99-170`),
  with attributes (hidden/system/cloud-placeholder) that Node's `fs.Stats` cannot provide at all, a
  15 s hard timeout, and a per-entry fallback when PowerShell is unavailable. The `before: 1 spawn +
  N stats / after: 1 spawn` note at `:22-25` is a measured claim, not a hope.
- **Cloud placeholders are never hydrated** (FR-027): `isCloudPlaceholder` from
  `FILE_ATTRIBUTE_OFFLINE`/`RECALL_ON_DATA_ACCESS`/`RECALL_ON_OPEN` (`:69-75`), surfaced in the UI, and
  nothing in the app opens a file during enumeration or sorting.
- **Drives are enumerated without ever touching the network**: `Get-CimInstance Win32_LogicalDisk`
  with a 4 s timeout (`windows-drives.js:56-71`) and a comment at `:9-13` explaining why
  `fs.readdir('\\\\')` is not used. Unreachable drives cannot hang the sidebar. Drive-type mapping
  (2/3/4/5/6) is correct, and paths are always rooted.
- **The Windows keyboard grammar is a single, documented map and it is not mixed with a Finder map**
  (D-0005): F2 rename, Delete to trash, Ctrl+Shift+N, Ctrl+Shift+C copy path, F5 refresh, Backspace
  back, Alt+←/→/↑ navigation, Space Quick Look — all in `app.js:3122-3257` and mirrored in the Help →
  Keyboard Shortcuts list (`:2088-2099`) and the HTML menus.
- **Rename is case-rename-correct**: a `readme.txt → README.txt` rename is detected as the same file
  and not refused (`file-operations.js:72-80`) — a real Windows trap.
- **Name validation is properly Windows-specific** (`file-name.js`): reserved device names including
  `CON.txt` via the stem check, trailing dot, control characters, `.`/`..`, and a 255-char segment cap,
  each with a sentence rather than an errno.
- **Live refresh beats the naive answer**: `fs.watch` *plus* a 1 s listing poll, with the reason
  documented (`folder-watcher.js:8-30`) — Google Drive's virtual drive returns a watcher that never
  fires. Seeding never fires, and a change is reported once.
- **Every failure is a sentence, never an errno**, consistently across read, list, operate and transfer
  (`list-directory.js:33-45`, `file-operations.js:110-133`, `transfer-files.js:113-123`), and partial
  failures report the count honestly ("3 of 5 done") rather than rounding to "Done".
- **Never-clobber is enforced at three layers** (use case, pre-flight `exists()` check, and
  `fs.cp` with `errorOnExist: true, force: false`) — `transfer-files.js:87-90`,
  `fs-file-operations.js:47-49`.
- **The IPC surface is narrow and test-enforced**: 21 named channels, `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true` (`main.js:150-155`), and `test/composition-root.test.js`
  fails if a channel the renderer can call is not registered, if a handler throws on no arguments, or
  if `transfer` reaches an undefined name. 137 tests pass.
- **FR-035 is actually honoured**: `grep` finds no association registration, no `setAsDefaultProtocolClient`,
  no registry writes, no Explorer setting changes anywhere in `src/`. The promise is kept.
- **The install config is the right shape**: per-user NSIS, no elevation prompt, Start-menu + desktop
  shortcuts, a real `.ico`, and an uninstaller via Add/Remove Programs (`electron-builder.yml:20-45`).
