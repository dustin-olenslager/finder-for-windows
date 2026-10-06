# Finder for Windows — Accessibility, Robustness & Error-Handling Audit

Scope: v0.13.0, `src/renderer/{index.html,app.js,style.css}`, `src/application/*`, `src/domain/paths.js`,
`src/adapters/*`, `src/infrastructure/main.js`.
Method: the real renderer driven against the stubbed bridge (`scripts/build-preview.py`) in Chromium via
Playwright. Every contrast ratio below is computed from **actual `getComputedStyle` colours**, composited
through ancestor backgrounds and CSS `opacity` — none are estimated. Every keyboard claim below was
produced by pressing the key and reading `document.activeElement` / the DOM afterwards. The repo's own
202-check behavioural suite was also run: **202 PASS, 0 FAIL** — so everything here is something that
suite does not look at.

Measured evidence files: `a11y-contrast.json`, `a11y-keyboard.json`, `a11y-errors.json`, `a11y-final.json`,
`a11y-dark.json`, `a11y-ax.json`, `probe-*.out` (all in `/opt/data/cache/scratch/`).

---

## 1. FINDINGS

Severity in brackets. "Blocks" means a whole class of user cannot do the thing at all.

---

### 1.1 KEYBOARD-ONLY USE

#### [BLOCKS EVERY KEYBOARD-ONLY USER] Tab never reaches a file row — files are unreachable without a mouse

A person who cannot use a mouse cannot get to a single file. Tab walks the menu bar, the toolbar, the
sidebar and the preview's own buttons, then falls out of the window and starts over. File rows are never
focusable, so there is no way to put the keyboard "into" the file list; the arrow keys only work after a
mouse click has established the selection.

Evidence — measured tab sequence (40 Tabs, then it repeats):

```
menubar-item File, View, Go, Help → icon-btn up → tool-btn sortBtn → tool-btn filterBtn
→ seg ×3 → INPUT search → icon-btn previewToggle → zoom buttons → crumb ×3
→ sidebar-item ×8 → preview step/close buttons → BODY → (back to File)
```

`tab_reaches_rows: false`. Census: `[tabindex]` positive: **0**, zero: **0**, native focusables: **38** —
and none of them is a row.

Cause: `buildRow()` creates a plain `<div class="row">` (`app.js:426-433`) with `role="option"` and no
`tabindex`. The icon view's cells *are* `<button>`s (`app.js:814`) so they are reachable, but the column
and list views — the default — are not. Search results do set `row.tabIndex = 0` (`app.js:520`), so
**search results are tabbable but folder contents are not** — an inconsistency, not a design.

Fix shape: one tab stop on the content area plus a roving `tabindex` on the selected row, or simply
`tabindex="0"` on the selected row and `-1` on the rest.

#### [BLOCKS] The whole menu bar is mouse-only — File, View, Go and Help do nothing from the keyboard

Enter and Space on a focused File/View/Go/Help button do nothing. The menu opens only from a `click`
handler. Measured:

```
focus .menubar-item[data-menu=file] → press Enter → menuOpen: false
                                    → press Space → menuOpen: false
                                    → press ArrowDown → menuOpen: false
```

Cause: `app.js:2142-2146` registers `click` (and `mouseenter`) only; there is no `keydown` path and no
`role="menubar"` / `aria-haspopup` on the bar items. The **context** menu has a keyboard grammar
(`app.js:3127-3143`: arrows move, Enter runs, Escape closes) and the toolbar dropdowns take focus — the
menu bar has neither.

Consequence, and this is the compounding part: the menu bar is the *only* home for a set of commands with
no shortcut at all — Sort, Filter, Tags, Home/Desktop/Documents/Downloads/Pictures, Build Search Index,
Open in Windows Explorer, Copy Name, "Back to Folder". So those are all mouse-only too, on top of the bar
itself.

#### [BLOCKS] Sort and Filter dropdowns are mouse-only

`#sortBtn` and `#filterBtn` are focusable and carry `aria-haspopup="menu" aria-expanded="false"`
(`index.html:42,49`), which promises a keyboard-operable menu. Measured: focus `#sortBtn` → Enter →
`menuOpen: false`, `panelMenu: null`, entries `[]`. Cause: `app.js:2751-2759` — `click` only.

Filter is the only way to narrow a folder to just the video takes (the owner's stated use case);
sort is the only way to order by date. Both are mouse-only.

#### [BLOCKS] Sort/Filter/Help menus cannot be dismissed with Escape, and `aria-expanded` is left lying

Escape closes the **context** menu only (`app.js:3127` guards on `.menu-context`). Measured:

| open panel | Escape result |
|---|---|
| File menu (menu bar) | still open |
| Sort dropdown | **still open**, `aria-expanded` still `"true"` |
| Context menu | closed ✔ |
| Quick Look | closed ✔ |
| Rename modal | closed ✔ |
| Keyboard Shortcuts modal | **still open** |
| Search field | cleared ✔ |
| Type filter active | **not cleared** |

`aria-expanded` is set `"true"` at `app.js:2821` and nothing ever sets it back. So a screen reader is told
the menu is open after the user has navigated away from it.

#### [BLOCKS] The global Enter/Space handler hijacks focused buttons

The document-level keydown handler (`app.js:3122`) does not bail out when focus is on a button, so pressing
Enter on a focused toolbar button opens the selected **file** instead of doing the button's job. Measured,
with `openWithDefault` instrumented:

```
focus #up (breadcrumb/up button) → Enter → openWithDefault("C:\Users\dustin\budget-2026.xlsx")
focus #up                        → Space → Quick Look opens
focus sidebar-item               → Enter → nothing at all
focus #previewToggle             → Enter → nothing at all
focus .seg[data-view=list]       → Enter → nothing (view does not change)
```

So three of the toolbar's own controls are keyboard-inert, and one (Up) actively does the wrong thing.
Cause: `app.js:3200` (`Enter && state.selected`) and `app.js:3166` (Space) run before any check on
`event.target`.

#### [BLOCKS] Ctrl+Arrow does not extend the selection; Home/PageDown are dead

Measured from a fresh selection of `logo.png`:

```
ArrowDown        → selection [logo.png]
Control+ArrowDown→ selection [notes.md]      ← REPLACED, did not add
Shift+ArrowLeft  → selection [logo.png]      ← works (range shrinks) ✔
Home             → selection [logo.png]      ← no move
PageDown         → selection [logo.png]      ← no move
```

Cause: the `applySelection` ctrl/shift model (`app.js:1498-1535`) is only reachable from a mouse `click`
(`app.js:2958-2985`); the keyboard only has `extendSelection` (Shift+Arrow, `app.js:1549`) and
`moveSelection` (`app.js:1566`). Non-contiguous selection — "copy these two and that one" — is
mouse-only. **Shift+Arrow range selection does work, and the status bar reports the range**, so the
range-select-and-copy path the brief asks about is fine on that half.

#### [BLOCKS] No keyboard route to the context menu — so tagging is mouse-only

`contextItemsFor()` (`app.js:2170`) is reached only from a `contextmenu` DOM event
(`app.js:2917, 2943, 2965`). There is no Shift+F10 / Menu-key handler. Tags can only be applied from
`contextItemsFor('item') → Tags…` (`app.js:2184`), so **the entire tags feature is mouse-only**, and so
are "Open in Windows Explorer" and the background commands.

#### [BLOCKS] The Keyboard Shortcuts dialog cannot be opened or closed without a mouse

Help ▸ Keyboard Shortcuts is the only route to the shortcut list, and the Help menu is keyboard-dead
(above). Once open, Escape does nothing (measured: modal still present). The dialog is a plain `<div
class="modal">` with no `role="dialog"`, no `aria-modal`, no `aria-labelledby` — the AX tree contains
**no dialog node at all** for it (`shortcuts_ax_dialogs: []`). Tab from it walks straight into the
background (21 background buttons still focusable, measured). Only the single "Done" button keeps focus
inside, and that is an accident of there being one focusable element.

#### Not-a-defect, for the record

Escape **does** correctly close the context menu, Quick Look and the rename modal; Escape **does** clear
the search field (`app.js:3088`); Shift+Arrow range select works; Ctrl+A / Ctrl+C / Ctrl+X / Ctrl+V /
Ctrl+F / Ctrl+Shift+C / Ctrl+Shift+N / Ctrl+1-3 / Ctrl+I / Ctrl+= / Ctrl+- / Ctrl+0 / F2 / F5 / Delete /
Backspace / Alt+arrows all work and are documented.

---

### 1.2 SCREEN READER

#### [BLOCKS] File rows are announced as nothing — no item role, no name, no selected state

A screen-reader user cannot tell that a list of files exists, cannot hear a filename as an item, cannot
hear which one is selected, and cannot hear folder-vs-file. This is the single worst finding in the
report.

`buildRow()` sets `role="option"` and `aria-selected="false"` on a `<div>` (`app.js:432-433`), but
`role="option"` is only valid inside a `role="listbox"`, and the parent is a plain `<div class="column">`
with no role (`app.js:707-709`). The role is therefore invalid and Chromium **drops it**:

- AX tree role census: `option: 0`, `listbox: 0`, `list: 0`, `listitem: 0` for file rows
  (`{InlineTextBox:60, none:57, StaticText:57, generic:36, button:29, listitem:9 (sidebar only), …}`).
- `Accessibility.getPartialAXTree` on `.row` → `{role: "generic", name: "", ignored: false}`.
- Nodes with a `selected` property anywhere in the tree: **0**.
- Nodes with role `option`: **0**.
- The filename `logo.png` appears only as loose `StaticText` under a nameless `generic` div.

So a screen reader reads a wall of unlabelled text, with no structure and no state. In icon view the cells
are `<button>`s so they at least have a name, but `aria-selected` is not set on them at all (`app.js:820`
toggles a CSS class only).

#### [BLOCKS] A selection change is not announced — and the live region churns the whole list

`#content` is `aria-live="polite"` (`index.html:137`). Every `render()` calls
`el.content.replaceChildren()` (`app.js:703, 740, 796`), so **one arrow key removes and re-inserts the
entire column**. Measured with a MutationObserver on `#content`:

```
one ArrowDown → removed: [DIV.column]
              → added:   [DIV.column  (64 descendants)]
```

With no `aria-atomic` and no `aria-relevant`, this is either silence or a 64-node name dump per keystroke;
either way **the newly selected filename is never a stable announced node**. The column container has no
`aria-label` and no role, so there is nothing to read the change *from*.

#### [BLOCKS] Toasts are not announced — every success and failure message is silent

`showToast()` (`app.js:1842-1849`) creates `<div class="toast">` with `textContent` and nothing else.
Measured attributes: `['class']` — no `role`, no `aria-live`, no `aria-atomic`. So all of these are
invisible to AT: `"3 items moved to the Recycle Bin."`, `"2 moved, 1 could not be: …"`,
`"Nothing was moved. …"`, `"That name is too long."`, `"Nothing matches…"` failures, clipboard
confirmations. The app's most honest messages are its least accessible.

#### [BLOCKS] The folder's item count is not announced

`#statusCount` is a bare `<span>` inside a bare `<footer>` (`index.html:163-166`). Measured: `role: null`,
`aria-live: null`, `tag: SPAN`, parent `FOOTER` with no role. It reaches the AX tree only as
`StaticText "11 items · 6 folders · selected: 47 KB"` — a static node nothing points AT at, and nothing
re-reads it when the folder changes. So "how many items are in this folder" is never spoken.

#### [BLOCKS] The error banner is not announced

`showColumnError()` (`app.js:1453-1460`) prepends `<p class="error">` into the live region. Measured:
`role: null`, `aria-live: null`, `tabindex: null`. An error can arrive and go unread, or be read as part
of a region-wide dump.

#### Menu-bar menus are not exposed as menus

The menu-bar panel (`toggleMenu`, `app.js:1995-2045`) sets `class="menu-panel"` and **no `role`**; its
entries are `<button>`s with **no `role="menuitem"`**. `#menubar` has `aria-label="Menu"` but no
`role="menubar"`, and `.menubar-item` has no `role`, no `aria-haspopup`, no `aria-expanded`. Measured.
(The context menu and the toolbar dropdowns *do* set `role="menu"`/`menuitem` — `app.js:2251,2264,2784,2796`
— so this is an omission in one of three menu implementations, not a global decision.)

#### Quick Look opens with focus left outside the dialog

Measured on open: `document.activeElement` = `BODY.has-preview`; the card has no `tabindex` and
`focusables: 0`; the AX `dialog` node is present (`role=dialog`, `name="Quick Look"`) but **not focused**.
The card carries `aria-modal="true"` (`index.html:170`) — a promise that background content is inert —
while the background is fully focusable. There is no `aria-labelledby`, so the filename is not part of the
dialog's name. Tab from the overlay walks the breadcrumb and sidebar underneath (measured: 8 Tabs →
`crumb Users`, `crumb dustin`, `sidebar-item Home`, …). **Escape does close it correctly.**

#### Two live regions, both weak

`aria-live` census: `#content` (polite) and `#mediaCount` (polite). `#mediaCount` has no role and is empty
until media is selected. There is no `role="status"` anywhere in the app.

---

### 1.3 CONTRAST — measured, both themes

Thresholds: 4.5:1 normal text, 3:1 large text and non-text UI. Ratios are composited (ancestor
backgrounds + CSS `opacity`) from real computed colours.

#### Dark theme

| Surface | fg | bg | ratio | needs | verdict |
|---|---|---|---|---|---|
| body text | #f2f2f4 | #1c1c1e | **15.22** | 4.5 | ok |
| selected row name | #fff | #0a68d8 | **5.27** | 4.5 | ok |
| sidebar item (active) | #fff | #0a68d8 | **5.27** | 4.5 | ok |
| status bar count / path | #98989d | #29292c | **5.07** | 4.5 | ok |
| inactive breadcrumb | #98989d | #29292c | **5.07** | 4.5 | ok |
| preview meta / info label | #98989d | #242427 | **5.41** | 4.5 | ok |
| empty-state hint | #98989d | #242427 | **5.41** | 4.5 | ok |
| search text | #f2f2f4 | #38383a | 10.49 | 4.5 | ok |
| **search PLACEHOLDER** | #98989d | #38383a | **4.08** | 4.5 | **FAIL** |
| **pattern PLACEHOLDER** | #757575 | #1c1c1e | **3.69** | 4.5 | **FAIL** |
| error banner | #ff6b60 | #2b1d1e | 5.80 | 4.5 | ok |
| badge "cloud" | #98989d | #2c2c2e | 4.86 | 4.5 | ok |
| badge "unavailable" | #e0a458 | #2c2c2e | 6.40 | 4.5 | ok |
| media counter | #98989d | #2b2b2e | 4.91 | 4.5 | ok |
| **disabled menu entry** | #98989d @ **opacity .55** | #1c1c1e | **2.73** | 4.5 | **FAIL** |

#### Light theme — this is where the theme is broken

| Surface | fg | bg | ratio | needs | verdict |
|---|---|---|---|---|---|
| body text | #1d1d1f | #fff | 16.83 | 4.5 | ok |
| selected row name | #fff | #0a68d8 | 5.27 | 4.5 | ok |
| **status bar count / path** | #7a7a7f | #fbfbfc | **4.12** | 4.5 | **FAIL** |
| **inactive breadcrumb** | #7a7a7f | #fbfbfc | **4.12** | 4.5 | **FAIL** |
| **breadcrumb separator ›** | #7a7a7f | #fbfbfc | **4.12** | 4.5 | **FAIL** |
| **empty-state hint** | #7a7a7f | #f7f7f9 | **4.00** | 4.5 | **FAIL** |
| **preview meta line** | #7a7a7f | #f7f7f9 | **4.00** | 4.5 | **FAIL** |
| **preview info label** | #7a7a7f | #f7f7f9 | **4.00** | 4.5 | **FAIL** |
| **media counter** | #7a7a7f | #eeeef0 | **3.67** | 4.5 | **FAIL** |
| **search PLACEHOLDER** | #7a7a7f | #f0f0f2 | **3.75** | 4.5 | **FAIL** |
| **menu accelerator** | #7a7a7f | #fff | **4.27** | 4.5 | **FAIL** |
| **badge "cloud"** | #7a7a7f | #f4f4f4 | **3.88** | 4.5 | **FAIL** |
| **badge "unavailable"** | #b26a00 | #f4f4f4 | **3.85** | 4.5 | **FAIL** |
| **disabled menu entry** | #7a7a7f @ **opacity .55** | #fff | **2.03** | 4.5 | **FAIL** |
| error banner | #b3261e | #f7e9e9 | 5.55 | 4.5 | ok |

One root cause covers ten of the light failures: `--fg-muted: #7a7a7f` (`style.css:19`) is too light for
every surface it is used on. Darkening it to ~`#6a6a70` clears 4.5:1 on `#fbfbfc`, `#f7f7f9` and
`#f0f0f2`. The two disabled-entry failures are `--fg-muted` **plus** `opacity: 0.55`
(`style.css:387-391`) — the extra opacity is what pushes 5.07→2.73 (dark) and 4.12→2.03 (light).

#### Focus indicators — measured, both themes

| Element | ring | against | ratio | needs 3:1 |
|---|---|---|---|---|
| `#up`, `#zoomOut/In`, `#previewClose`, `.seg` (dark) | #4c9aff | #29292c / #38383a | 5.11 / 4.12 | ok |
| `.menubar-item`, `.crumb`, `#sortBtn`, `#filterBtn` (dark) | UA `auto` | #29292c | 12.54 | ok |
| `.menu-entry` (dark) | UA `auto` | #2c2c2e | 12.49 | ok |
| **`.seg` active (dark)** | #4c9aff | #606062 | **2.22** | **FAIL** |
| **`.sidebar-item.is-active` (dark)** | #4c9aff | #0a68d8 | **1.85** | **FAIL** |
| **`#previewToggle.is-on` (dark)** | #4c9aff | #0a68d8 | **1.85** | **FAIL** |
| `#up`, `#zoomOut/In`, `#previewClose` (light) | #0a68d8 | #fbfbfc / #f0f0f2 | 5.09 / 4.63 | ok |
| `.seg` active (light) | #0a68d8 | #fff | 5.27 | ok |
| **`.sidebar-item.is-active` (light)** | #0a68d8 | #0a68d8 | **1.00** | **FAIL — invisible** |
| **`#previewToggle.is-on` (light)** | #0a68d8 | #0a68d8 | **1.00** | **FAIL — invisible** |
| **`#search` (both themes)** | **`outline: 0`** | — | **none** | **FAIL — no ring at all** |

The `:focus-visible` rule (`style.css:234-240`) sets `outline: 2px solid var(--accent)`, and
`--accent` is *the same colour* as `--bg-selected` in the light theme, so on a selected sidebar item the
focus ring is drawn in exactly the background colour it sits on. In the dark theme it is 1.85:1. So the
focused row in the sidebar — the one place a keyboard user most needs to see — is the one place the ring
disappears.

`#search` has no focus indicator at all: `style.css:295` is `outline: 0` on `.search input` and there is
no `:focus-visible` rule for the input (only `.modal-input` and `.patternbar input` get one,
`style.css:984, 1121`). Measured: `outline-style: none, outline-width: 0px, box-shadow: none`. A keyboard
user who tabs to Search — the only route to search — gets no feedback.

#### Non-text UI

The selected-row fill `#0a68d8` against `#fff`/`#1c1c1e` is 5.27 both ways; the row separators
`--line` are decorative. The `.badge` is 10px text — it *is* text, so it needs 4.5:1, and fails in light.

---

### 1.4 MOTION AND COGNITIVE LOAD

Measured with `prefers-reduced-motion: no-preference` and `reduce`, enumerating every element's
`transitionDuration` and `animationName`:

- Exactly **one** animated thing in the whole app: `.toast { transition: opacity 0.4s ease }`
  (`style.css:1020`), fading out via `.is-leaving` (`style.css:1023`) then removed after 3.1 s.
- Nothing flashes, nothing loops, nothing moves unexpectedly. There is no spinner anywhere; the
  `Searching…` and `Indexing…` states are text.
- **It does not respect `prefers-reduced-motion`**: measured identical transition duration under
  `reduce`. No `@media (prefers-reduced-motion: reduce)` block exists in `style.css`.

So the motion finding is small and narrow: one 400 ms opacity fade, unguarded. It is worth noting that
the toast is *also* the element that is not announced (1.2), so a single fix — a `role="status"`
container that is not the thing being removed — addresses both.

Cognitive-load observations worth stating plainly: the toast is the app's only feedback channel and it
carries up to 590 px of text (measured: the partial-failure toast was `590×58 px`), it stacks with other
toasts (2 simultaneous, overlapping in the same fixed slot — measured `bottom: 686` and `bottom: 658`),
it has no `max-width` and no `overflow-wrap` (measured `maxWidth: none, overflowWrap: normal`), and it
disappears after 2.6 s. A long failure message is on screen for 2.6 seconds and cannot be re-read.

---

### 1.5 ERROR AND EDGE STATES — what the user actually sees

Each row below is the measured screen, not the intent.

| Situation | What the user sees | Truthful? |
|---|---|---|
| **Empty folder** | `Empty` (column view, `app.js:716`) / `This folder is empty.` (list, `app.js:779`); status `0 items · 0 folders` | ✔ |
| **Empty search, no index built** | `Nothing matches yet — the index has not been built. Use "Build Index".` + the index bar `Search inside files needs an index. Building it reads file names first, then contents.` | ✔ good |
| **Empty search, index built** | `Nothing matches "zzzz".` + `0 results for "zzzz" everywhere` | ✔ |
| **Search itself failed** | **`Nothing matches "aaaa".`** — the error is thrown away | ✘ **lies** |
| **Unreadable folder (EACCES)** | banner `You do not have permission to open: C:\Users` **and, underneath it, `Empty`** + status `0 items · 0 folders` | ✘ **contradictory** |
| **Folder vanished (ENOENT)** | banner `That folder no longer exists: …` + `Empty` + `0 items` | ✘ contradictory |
| **Disconnected / network drive (UNKNOWN)** | banner `That location is unavailable: …` + `Empty` + `0 items` | ✘ contradictory |
| **Bridge call *rejects*** (not `{ok:false}`) | **the previous folder's listing, no message, no banner** — plus an uncaught page error | ✘ **silent** |
| **`startFolder()` rejects** | **`Loading…` forever** (index.html:138) | ✘ silent |
| **Trash: permission denied** | `Nothing was moved. logo.png: You do not have permission to change C:\Users\dustin\logo.png` | ✔ good |
| **Trash: partial batch (2 of 3)** | `2 moved, 1 could not be: notes.md: You do not have permission to change …` | ✔ good |
| **Rename: name too long** | modal **closes**, toast `That name is too long.`, typed name discarded | ✘ data loss |
| **Rename: duplicate name** | modal stays open, title becomes `Rename — There is already an item named "Desktop" here.`, text preserved, input refocused | ✔ good |
| **File deleted by another program while selected** | selection silently cleared; **no message at all** | ✘ silent |
| **Folder vanishes mid-navigation** | error column banner; `refreshAfterMutation` stops at the first bad column ✔; `refreshLive` does **not** and leaves an empty column with no banner | partly |
| **Copy/paste into the same folder** | `0 of 2 done. logo.png: There is already an item named "logo.png" in that folder.` | ✔ good |
| **Delete on a folder** | no confirmation, item moved to Recycle Bin, `"Videos" moved to the Recycle Bin.` | ✔ true, but see 1.6 |
| **Index running** | `Indexing… 1,234 files in 56 folders · C:\…` — live numbers, never a bare spinner | ✔ good |
| **Index done** | `Index covers 3 files · 2 with contents read · built in 1 min` | ✔ good |
| **Watch failure** | nothing; live refresh is silently off (`app.js:1839` `.catch(()=>{})`) | ✘ silent |

Detail on the worst three:

**A rejected bridge call leaves the stale screen and throws.** `readColumn()` (`app.js:1388-1394`) does
`const result = await window.finder.listDirectory(path)` with no `try`. Every caller (`openFolder`,
`descend`, `selectInColumn`, `refreshAfterMutation`, `refreshLive`) awaits it. Measured with a rejecting
stub: `pageerror: 'bridge exploded'`, and the content area still showed the previous folder's rows —
`Desktop Documents Downloads …` — with the title still `dustin`. The user sees a normal-looking folder
that is not the one they asked for. This is the version-skew / channel-missing case, which is exactly
when a user is most confused.

**Search failure is rendered as "no results".** `runSearch` records `state.searchError` on both the
`!result.ok` path and the `catch` (`app.js:602, 606`), and `renderSearchResults` never reads it — grep for
`searchError` returns three hits, all writes, none in the render path. Measured: stub returns
`{ok:false, error:'The search index could not be read.'}` → screen shows `Nothing matches "aaaa".` A
false negative stated as fact, on the feature whose entire job is to tell the user whether something
exists.

**`Empty` is printed under an error banner.** `renderColumns` prints the empty hint whenever
`items.length === 0` (`app.js:713-717`) and `showColumnError` prepends the banner afterwards
(`app.js:1453-1458`). Measured content text: `"You do not have permission to open: C:\UsersEmpty"` with
status `0 items · 0 folders`. A folder the app could not read is reported as a folder with nothing in it.

---

### 1.6 HONESTY — does it ever claim success when it failed?

This is the strongest area of the codebase, and it has two real holes.

**Good, and worth protecting:**

- **Trash never claims a Recycle Bin for a permanent delete.** `isRecyclable()` (`domain/paths.js:138-144`)
  refuses any UNC path, and `file-operations.js:99-104` returns
  `A file on a network location cannot go to the Recycle Bin. Nothing was deleted.` The comment at
  `paths.js:130-136` documents the exact Electron behaviour being defended against
  (`shell.trashItem` silently permanently deletes a UNC path and reports success). This is precisely the
  honesty the owner asked for.
- **Trash success is counted, not assumed** — `trashSelected` only increments on `result.ok`
  (`app.js:1754`), and partial failure is reported as partial (`app.js:1772-1776`).
- **Copy never silently overwrites** (`transfer-files.js:87-90`), and a partial copy says
  `3 of 5 done` (`transfer-files.js:109`).
- **Clipboard copy is verified by read-back**, not hoped for (`main.js:219`
  `return { ok: clipboard.readText() === value, value }`).
- **No bare spinner anywhere.** The index bar carries live counts, elapsed time and coverage.

**Hole 1 — a mapped network drive will be permanently deleted and reported as "moved to the Recycle
Bin".** `paths.js:135-136` says it in the code: *"The same applies to a mapped or substituted drive, but
those cannot be told apart from a real drive by their path alone, so they are not guessed at here."* A
mapped drive is `Z:\` — indistinguishable from a local volume by path. `shell.trashItem` on a mapped
network drive permanently deletes. The app then says `"Videos" moved to the Recycle Bin.` This is the one
place the app can lie, the code knows it, and the drive data needed to fix it is *already in the
process*: `windows-drives.js:77-84` reads `DriveType` (4 = network) from `Win32_LogicalDisk` for the
sidebar. The information exists and is not used at the trash decision.

**Hole 2 — the File menu's "Paste" is not disabled, though the code says it is.**
`MENUS.file` declares `{ label: 'Paste', disabled: true, note: 'Copy or cut something first' }`
(`app.js:1925`), but `toggleMenu` never reads `entry.disabled` (`app.js:2007-2036` — it only checks
`entry.separator`, `entry.accel` and `entry.label`). Measured: **all 11 File entries `disabled: false`**,
Paste `title: ""`. Clicking it runs `pasteInto()` and produces the toast `Nothing has been copied yet.`
So the promise "a greyed entry that explains itself beats a missing one" (`app.js:2278-2281`) is kept in
the context menu and broken in the menu bar. The toolbar dropdowns are half-way there: they set
`disabled` but never the `title` note (`app.js:2806-2807` vs `app.js:2277-2281`), so "Show All Types"
is greyed with no explanation.

**Hole 3 — the keyboard Delete path destroys a whole folder tree with no confirmation, while the context
menu deliberately refuses to offer it.** Measured: select `Videos` (a folder) with ArrowUp, press Delete
→ `fileOperation({op:'trash', path:'C:\Users\dustin\Videos'})` → `"Videos" moved to the Recycle Bin.`,
`anyConfirmDialog: false`. The context menu omits the entry for folders on purpose, with a stated reason
(`app.js:2193-2195`: *"A folder cannot be renamed away while you are standing in it, and this app has no
recursive delete yet, so the honest thing is not to offer it"*) — and the keyboard path does it anyway.
The Recycle Bin is recoverable, so this is not a lie, but it is the most destructive action in the app
with the least warning, and the two entry points disagree about whether it is allowed.

---

## 2. RANKED PLAN

Ranked by how many people it blocks × how badly. S/M/L is effort.

### Tier 1 — every keyboard-only user is blocked today

| # | Fix | Size |
|---|---|---|
| 1 | **Make file rows reachable by Tab.** One tab stop on `#content` + roving `tabindex` (`0` on the selected row, `-1` on the rest), and focus the selected row on render. `buildRow` `app.js:426`. | S |
| 2 | **Give the menu bar a keyboard.** Enter/Space/ArrowDown on `.menubar-item` → `toggleMenu`; `role="menubar"` on `#menubar`, `role="menu"` on the panel, `role="menuitem"` on entries, `aria-haspopup`+`aria-expanded` on the items; arrows move, Escape closes and restores focus. `app.js:1995-2045, 2142`. | M |
| 3 | **Give Sort/Filter the same keyboard**, and reset `aria-expanded` on close. `app.js:2751-2824`. | S |
| 4 | **Escape closes every panel.** Extend the open-menu branch (`app.js:3127`) to any `.menu-panel`, and add an Escape handler to the shortcuts modal. | S |
| 5 | **Stop hijacking focused buttons.** In the global handler, return early when `event.target` is a `button`/`input`/`select` (`app.js:3122`). Fixes Enter-on-Up opening a file, Space-on-Up opening Quick Look, and Enter doing nothing on sidebar/view/preview controls. | S |
| 6 | **Ctrl+Arrow extends the selection; Home/End/PageUp/PageDown move it.** Route them through `applySelection`'s ctrl branch. `app.js:3122`. | S |

### Tier 2 — every screen-reader user is blocked today

| # | Fix | Size |
|---|---|---|
| 7 | **Make the file list a real list.** `role="listbox"` + `aria-label` on `.column`, `role="option"` + `aria-selected` + an accessible name on each row, so `option` stops being dropped. Or, if the roving-tabindex fix lands, `role="list"`/`listitem`. `app.js:707-726`. | M |
| 8 | **Announce selection with one stable status line**, not a live region that rebuilds 64 nodes. Add `<span id="a11yStatus" role="status">` and set it to `"logo.png, 2 of 11, selected 180 KB"`. `index.html:163`, `app.js:397`. | S |
| 9 | **Announce toasts.** Wrap the message in a `role="status" aria-live="polite"` element that is not the node being removed at 3.1 s. `app.js:1842`. | S |
| 10 | **Announce errors.** `role="alert"` on the column banner (`app.js:1456`) and on `.modal-error` (already has `role="alert"` — keep it). | S |
| 11 | **Expose the item count and the current folder to AT** — give `#statusCount`/`.statusbar` `role="status"`, and give `.column` an `aria-label` of the folder name. | S |
| 12 | **Move focus into Quick Look** (`tabindex="-1"` + `focus()`), add `aria-labelledby` pointing at the filename, and make the background `inert` while it is open — or drop `aria-modal="true"` so the app stops claiming something untrue. `index.html:169-179`, `app.js:1123`. | S |
| 13 | **Make the shortcuts modal a dialog**: `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape closes. `app.js:2083-2140`. | S |

### Tier 3 — low-vision users

| # | Fix | Size |
|---|---|---|
| 14 | **Fix the focus ring on selected items.** Use a ring that contrasts with the fill as well as the background (e.g. `outline: 2px solid var(--bg)` + `box-shadow: 0 0 0 4px var(--accent)`, or a white ring in light / `#4c9aff` in dark). Currently 1.00 light and 1.85 dark on `.sidebar-item.is-active` and `#previewToggle.is-on`. `style.css:234-240`. | S |
| 15 | **Give the search input a focus ring.** Remove `outline: 0` (`style.css:295`) or add `.search input:focus-visible` matching `.modal-input`. | S |
| 16 | **Darken `--fg-muted` in the light theme** to ≈`#6a6a70` — clears 4.5:1 on `#fbfbfc`/`#f7f7f9`/`#f0f0f2` and fixes 10 measured failures at once. `style.css:19`. | S |
| 17 | **Drop the extra `opacity: 0.55` on disabled menu entries** (or raise it to ≈0.8) — `--fg-muted` alone is 4.12 light / 5.07 dark, both passing. `style.css:387-391`. | S |
| 18 | **Badges and placeholders**: `--warn` `#b26a00` and `--fg-muted` on the badge background, and `::placeholder` — darken to clear 4.5:1. `style.css:790, 302, 1121`. | S |

### Tier 4 — honesty and the bad day

| # | Fix | Size |
|---|---|---|
| 19 | **Wrap `readColumn` and the first-paint `startFolder()` in `try/catch`** and render the same banner; a rejected IPC must never leave the previous folder on screen or `Loading…` forever. `app.js:1388, 3263-3268`. | M |
| 20 | **Render the error *instead of* the empty state** — do not print `Empty` under a banner that says the folder could not be opened. `app.js:713, 1453`. | S |
| 21 | **Render `state.searchError`** in `renderSearchResults` so a failed search says so rather than `Nothing matches`. `app.js:497-505`. | S |
| 22 | **Re-prompt on every rename failure**, preserving the typed text — not only for the four regex-matched cases. `app.js:1687-1694`. | S |
| 23 | **Confirm before trashing a folder** (or refuse, as the context menu already does) — the keyboard path currently deletes a whole tree with no warning. `app.js:1745, 3211`. | M |
| 24 | **Refuse to "Recycle" a mapped network drive.** Use the `DriveType === 4` data the app already reads (`windows-drives.js:77-84`) to mark mapped drives and have `isRecyclable`/`trash` refuse them, the same way it refuses UNC. `paths.js:138`, `file-operations.js:96-104`. | M |
| 25 | **Say when a watched file disappears.** A status line when `refreshLive` drops the lead. `app.js:1824`. | S |
| 26 | **Honour `entry.disabled` and `entry.note` in the menu bar**, and set `title` on disabled toolbar dropdown entries. `app.js:2007-2036, 2806`. | S |
| 27 | **Stop swallowing watch failures** — surface that live refresh is off, and put F5 in the shortcut list. `app.js:1839, 2084-2102`. | S |

### Tier 5 — small

| # | Fix | Size |
|---|---|---|
| 28 | **Guard the toast fade with `@media (prefers-reduced-motion: reduce)`.** `style.css:1020`. | S |
| 29 | **Cap the toast width and wrap long text** (`max-width: 60ch; overflow-wrap: anywhere`) — measured 590 px wide with no cap, stacked toasts overlapping. `style.css:1008`. | S |
| 30 | **Give icon-view cells `aria-selected` and an `aria-label` including kind.** `app.js:814-833`. | S |

**Smallest change with the largest reach:** items 1, 5 and 9 together — a tab stop on the file list, the
button hijack removed, and an announced toast — turn the app from "mouse required" into "keyboard usable
with spoken feedback" for the majority of the findings above, and they are each a handful of lines.

---

## 3. DELETION CANDIDATES

Argued, per the Algorithm's Delete step. Each entry says whether it should be removed and why.

1. **`labelForLetter` and `volumeName` in `windows-drives.js:20-45` — DELETE.** Dead code: never called,
   never tested (grep across `src/` and `test/` finds no reference outside the file), and `volumeName`
   ends by returning `null` unconditionally with a comment saying the real label needs a platform call
   the app does not make. It is a stub that was left behind when the sidebar switched to
   `Win32_LogicalDisk`. Removing it deletes a function whose whole body is `return null`.

2. **The `role="option"` / `aria-selected` pair on rows (`app.js:432-433`) — DELETE THE ROLE FIRST, then
   decide.** As shipped the role is *invalid* (no `listbox` ancestor) and Chromium drops it — measured
   zero `option` nodes in the accessibility tree. Keeping an attribute that the accessibility engine
   ignores is worse than having none: it makes the code look accessible to a reader of the source while
   the screen reader hears nothing. Either promote it into a real listbox (fix 7) or remove it. Do not
   leave it as decoration.

3. **`aria-sort` on `.list-sort` buttons (`app.js:761`) — DELETE.** `aria-sort` is only meaningful on
   `columnheader`/`rowheader`/`th`; on a `<button>` inside a `<div>` it is inert. Measured: the AX node
   for the "Name ↑" button exposes `focusable`, `hasPopup`, `expanded` — and **no sort property**. The
   app's own suite asserts the *attribute* (`scripts/verify-ui.py:871-882`) and so passes while the
   assistive effect is absent. The state is already carried in the button's accessible name
   (`"Name ↑"`), so the attribute adds nothing. Deleting it removes a false signal; if real sort state is
   wanted later, it needs a `role="grid"` header, which is a bigger change than this attribute implies.

4. **`metadataUnavailable` and its "unavailable" badge (`app.js:469-475`) — DELETE, or wire it up.**
   The flag is set `true` only in the non-Windows fallback path (`fs-directory-reader.js:206`); the
   Windows bulk route always sets it `false` (`fs-directory-reader.js:183`). On the only platform this
   app ships to, the badge is unreachable — it is a code path that exists to handle a case that cannot
   occur there. Either have the bulk route set it when an entry's metadata is genuinely missing, or drop
   the badge and its CSS.

5. **The four-string `is-checked` comparison in `toggleMenu` (`app.js:2023-2030`) — SIMPLIFY, not
   delete.** It compares the entry's *label text* against four hardcoded strings to decide whether to draw
   a tick. Adding `checked: true` to the MENUS entries is the same number of lines, survives a wording
   change, and stops the menu's state living in a string. (Noted as a deletion candidate because the
   four-label list is machinery that a single field replaces.)

6. **The `.crumb-sep` glyph as a text node — SIMPLIFY to `aria-hidden`.** It is a decorative `›` read out
   by AT between every path segment; it needs `aria-hidden="true"`, not removal.

7. **`aria-modal="true"` on the Quick Look card (`index.html:170`) — DELETE OR MAKE TRUE.** It is
   currently a claim that the background is inert, and the background is fully focusable (measured: Tab
   from the open overlay reaches the breadcrumb and the sidebar). An attribute that states something
   false is ceremony. Either make the background inert and move focus in (fix 12), or remove the
   attribute until that is done.

8. **A dedicated `aria-live` on `#content` (`index.html:137`) — DELETE once fix 8 lands.** A polite live
   region wrapping the entire file listing, which is rebuilt wholesale on every keystroke, is not a
   mechanism for announcing a selection; it is a mechanism for announcing everything. Replace it with one
   small `role="status"` line and remove `aria-live` from `#content`. The live region on `#mediaCount`
   (`index.html:150`) can stay — it is small and its content is exactly what it says.

9. **"The whole request" — considered and rejected.** The brief asks whether the app should carry an
   accessibility layer at all, or whether a Windows-native control set (a real `listview`) should replace
   the hand-built DOM. That is a legitimate deletion candidate: a native list view would arrive with
   keyboard navigation, row roles, selection announcement and focus handling for free, and the hand-built
   version is where findings 1, 7, 8, 11 and 12 all come from. It is rejected here because it is a
   rewrite of the rendering layer, not a fix, and the app's own four-view structure (column/list/icon/
   results) is the product's whole point. Recorded so the next agent sees it was considered: **doing
   fixes 1 and 7 by hand is cheaper than adopting a native list, and the two are not mutually exclusive
   later.**

---

## 4. WHAT IS ALREADY GOOD

Named, so it is not lost in a refactor.

- **A visible menu bar exists at all** (`index.html:14-20`) so no feature is shortcut-only. The intent is
  right even though its keyboard wiring is missing.
- **Every icon button has `aria-label` and `title`**, and every decorative SVG is `aria-hidden="true"`
  (`index.html:24-99`). The icon vocabulary is accessible by construction.
- **Quick Look is a real dialog**: `role="dialog" aria-modal="true" aria-label="Quick Look"`
  (`index.html:170`), Escape closes it, and it opens on Space.
- **Escape works where it is wired**: context menu, Quick Look, rename modal, search field — all
  measured closing/clearing correctly.
- **The rename dialog preserves the typed name on a name clash** and refocuses the input with the stem
  selected (`app.js:1668-1671, 1687-1691`) — measured: title becomes the reason, text intact.
- **Shift+Arrow range selection works**, the anchor is a real anchor, and the status bar reports the
  selection (`app.js:1549-1563`, measured).
- **Errors are sentences, never errnos.** `describeReadFailure` (`list-directory.js:33-50`),
  `describeOperationFailure` (`file-operations.js:111-133`) and `sentenceFor` (`transfer-files.js:114-123`)
  all map codes to human text. The contract is stated in the file header
  (`file-operations.js:14`: *"The use case returns a SENTENCE on failure. The renderer never sees an
  errno."*).
- **Partial failures are reported as partial** — `"2 moved, 1 could not be: …"` (measured), and
  `transfer-files.js:109` composes the same shape.
- **The app refuses to lie about the Recycle Bin on a UNC path**, with the reason and the defence
  documented in code (`paths.js:130-136`, `file-operations.js:96-104`).
- **Nothing is silently overwritten** — copy, move and rename all refuse a clash
  (`transfer-files.js:87-90`, `file-operations.js:78-80`).
- **Clipboard success is verified by read-back** (`main.js:219`) rather than assumed.
- **No bare spinner anywhere.** The index bar shows live file/folder counts, elapsed time and coverage
  (`app.js:637-663`), and the search bar shows the term, the scope and the count.
- **The empty-search-with-no-index state tells the user how to fix it** rather than showing an empty list
  (`app.js:500-503`).
- **The cloud-placeholder badge explains itself in a tooltip** and the adapter never hydrates a file to
  read its name (`fs-directory-reader.js:30-32, 462-468`).
- **`prefers-reduced-motion` is trivially satisfied** — nothing animates except one 400 ms toast fade, so
  the motion exposure is as close to zero as a desktop app gets.
- **The primary reading surfaces pass contrast comfortably in both themes**: body text 15.22/16.83,
  selected-row text 5.27/5.27, sidebar text 5.27/5.27. The failures are all in secondary and disabled
  text, not in the content a user reads.
- **The 202-check behavioural suite is green with no page errors** — everything in this report is outside
  what it covers, not a regression it missed.
