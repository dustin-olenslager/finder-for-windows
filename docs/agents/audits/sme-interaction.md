# Interaction audit — Finder for Windows (v0.13.0)

Scope: does this behave the way a person expects a file manager to behave, and can every
feature be FOUND without knowing a keyboard shortcut?

Method: built the real renderer with `scripts/build-preview.py` and drove it with Playwright
(measured DOM, computed styles, hit targets, contrast, and real copy/paste/trash transfers).
Ran the behavioural suite: `scripts/verify-ui.py` → **202 checks, 0 failures**. That matters:
everything below is a real defect the suite does NOT cover, not a regression.

---

## 1. FINDINGS

Each finding: plain English first, then evidence.

### F1 — In column view, "Back" is dead after you click into a folder (the flagship view is the broken one)
You are in column view (the default). You click `Documents`, then `Pictures`. Now you want to
go back. The Back arrow is greyed out and clicking it does nothing. The only way back is the
Up arrow or the breadcrumb, which is not what the Back arrow promises. In list and icon view
the same double-click DOES populate Back — so the app's most-used view is the one where
history is missing.
Evidence: `state.columns` click path `selectInColumn` (app.js:1427-1451) descends by pushing a
column and never calls `pushHistory`; only `openFolder` (app.js:1397-1410) calls it
(`pushHistory` at app.js:1399 is the ONLY caller — `grep -n "pushHistory()"`). `renderNavButtons`
sets `el.back.disabled = backStack.length === 0` (app.js:368). Measured: click `Documents` in
column view → `back: true` (disabled) while `cols: 2`; via sidebar → `back: false`. Reproduced
twice (`Page.click('#back')` timed out on a disabled button in two separate runs).

### F2 — The Back arrow never becomes usable after ANY in-app folder click in column view
Same root cause as F1 but worth its own line because it is the single most-used gesture: a
plain click on a folder row in column view is the app's core navigation, and it is the one
gesture that leaves no history. A user who lives in column view never gets a working Back.
Evidence: F1.

### F3 — "Back" is unreachable in the View menu while you are searching, so the menu cannot undo search
`Back to Folder` is filed under the **View** menu (app.js:1953). A user searching for the way
back will look under Go or File, not View. Worse, while search results are showing the natural
"go back" keys (`Backspace`, `Alt+←`) call `goBack()` — which restores a *navigation* snapshot,
not the folder listing — while the actual way back (`Esc`) is documented under View. The one
place a lost user looks is the wrong menu.
Evidence: `MENUS.view.items` app.js:1938-1957 contains `{ label: 'Back to Folder', accel: 'Esc' }`;
`MENUS.go` (app.js:1958-1971) has Back/Forward/Enclosing but no "back to folder".

### F4 — Turning on a type filter blanks every ANCESTOR column, so the folder you came from looks empty
In column view you are three columns deep (`Videos` → `03_Approved`). You click Filter → Video.
The column you were standing in correctly shows 6 videos — but the `Videos` column behind it
now shows **5** rows instead of 6, and the root column shows **6** instead of 11, and in general
a folder can appear empty because a filter meant for the current folder is applied to every
column on screen. The user reads this as "the app lost my folders".
Evidence: `renderColumns` calls `presentItems(column.items)` for EVERY column (app.js:711), and
`presentItems` = `applySort(applyFilter(...))` (app.js:341-343) using the global
`state.kindFilter`/`state.pattern`. Measured: `03_Approved` column-view depths `[11, 6, 9]`
before → `[6, 5, 6]` after a Video filter.

### F5 — The type filter and name pattern are sticky across folders, so the next folder opens "empty"
Filter for Video + pattern `V003` in a shot folder, then click Home. Home shows **0 items** with
the pattern bar still reading `V003` and the Filter button still reading `Video`. Nothing is
wrong with the folder — the filter followed you — but a user who did not notice the small toolbar
labels concludes the folder is empty. (The bar does show the value, so it is discoverable *if*
you look, but the default experience is "my files vanished".)
Evidence: `openFolder` clears `state.filter` but NOT `state.kindFilter`/`state.pattern`
(app.js:1405 vs app.js:1401-1406); measured: filter+pattern `2 items` in `03_Approved` →
`0 items · 0 folders · filtered from 11` in Home.

### F6 — The "Name contains" bar is shown even when only the PATTERN is set, contradicting its own guard
The comment says the bar appears "whenever a type filter is on", but `renderPatternBar` shows it
when `isFiltering() || pattern !== ''` (app.js:2747) — i.e. it also appears for a pattern-only
filter. That is arguably fine, but the empty-state text is the tell: the bar's Clear button is
labelled `Clear` while the other is `Show all types`, so a user with only a pattern set is offered
"Show all types" (which clears nothing they set) and must guess that "Clear" is the one that
matters.
Evidence: app.js:2746-2749; patternbar markup index.html:123-129 (`patternClear` label "Clear",
`filterClear` label "Show all types"). Measured: pattern-only state leaves `patternHidden:false`
with `filterLabel:"Filter"` — the "Show all types" button is visible and inert.

### F7 — There is no keyboard reach for the folder listing, so nothing announces and arrow keys are the only way in
Rows are `<div>`s with no `tabindex` (app.js:427-433); only SEARCH results get `tabIndex = 0`
(app.js:520). A keyboard-only user (or anyone using Tab) cannot reach a file in the listing, and
screen readers get a `role="option"` with no listbox parent. The keyboard shortcuts work once you
are "in" the list, but there is no way to focus the list.
Evidence: measured `row_focus = {tag:'DIV', tabindex:null, focusable:false}`; app.js:520
(`row.tabIndex = 0` only in `renderSearchResults`).

### F8 — The keyboard-shortcuts screen omits the shortcuts people most need to find
Help → Keyboard Shortcuts lists 17 rows but is missing `Ctrl+C` (Copy), `Ctrl+X` (Cut),
`Ctrl+V` (Paste), `Ctrl+A` (Select All), and `F5` (Refresh) — the five most common file-manager
keys. A user who opens the one screen that promises to teach shortcuts learns everything except
how to copy, cut, paste, select all, or refresh.
Evidence: `showShortcuts` rows app.js:2084-2102 — no Copy/Cut/Paste/Select All/Refresh entries,
though all five are implemented (app.js:3234-3251).

### F9 — The menu bar is not keyboard-operable and does not close with Escape
Click File, then press Escape: the menu stays open. Arrow keys do nothing (focus stays on
`<body>`). There is no `aria-haspopup`, `aria-expanded`, or `role="menu"` on the menu bar
buttons, so the menu is a pointer-only surface. Every other menu in the app (context menus,
dropdowns) IS keyboard-driven, which makes this inconsistent as well as inaccessible.
Evidence: measured — `open_after_esc: true` (still open), `focus_after_arrowdown: {tag:'BODY'}`,
`menubar_aria: {haspopup:null, expanded:null, role:null}`. Contrast with context menus, which get
`role="menu"`/`role="menuitem"` and arrow navigation (app.js:3127-3143, 2251/2264).

### F10 — Clicking a folder in list/icon view navigates immediately; you cannot select a folder to act on it
In list or icon view, a single click on a folder opens it. That means the only way to *select* a
folder (to rename it, tag it, or bin it) is a right-click — which is not discoverable and is
exactly the "I could not tell if it worked" class of problem. In column view a click selects;
in list/icon it navigates. The same gesture means two different things.
Evidence: measured — list view click on `Pictures` → `title: 'Pictures'`, `rows: 0`
(navigated); column view click on a folder → `cols: 2`, selected stays (previews). Double-click
handlers at app.js:2990-3014 confirm list/icon `openFolder(path)`.

### F11 — The right-click menu silently omits "Move to Recycle Bin" for folders, but the menu bar and Delete key DO bin them
Right-click a folder: there is no "Move to Recycle Bin" (deliberate — app.js:2193-2195). But the
**File menu's** "Move to Recycle Bin" is enabled for a folder (measured `disabled: false`), and
pressing Delete bins it. So the app deliberately hides the destructive action from the discoverable
menu, then offers it from the two less-discoverable paths. A user who right-clicks a folder
concludes folders cannot be deleted.
Evidence: `contextItemsFor('item')` returns `isFolder ? null : {label:'Move to Recycle Bin'…}`
(app.js:2195); measured File menu trash `disabled:false`; keyboard `Delete` → `trashSelected`
(app.js:3211-3213) fires regardless of `isDirectory` (measured: Ctrl+A then Delete →
`"11 items moved to the Recycle Bin."`).

### F12 — Destructive actions have no confirmation, and Ctrl+A + Delete bins the whole folder in one keystroke
Select All then Delete moves **11 items** to the Recycle Bin with no confirm dialog. In a
file manager this is the classic accidental-mass-delete. The toast says what happened but the
files are already gone from the listing.
Evidence: measured Ctrl+A → 11 selected, Delete → `"11 items moved to the Recycle Bin."`;
`trashSelected` (app.js:1745-1777) has no confirmation step.

### F13 — With nothing selected, Rename and Open do nothing at all — no message
Deselect everything (click a sidebar favourite), then File → Rename, or File → Open: nothing
happens, no toast, no dialog. The user cannot tell whether the command is broken or simply has
no target. Copy/Cut DO say "Select something first." — the inconsistency is the defect.
Evidence: `renameSelected` returns silently when `!state.selected` (app.js:1726-1727);
`openSelected` returns silently (app.js:2057); measured `rename_no_sel_toast: []`,
`open_no_sel_toast: []`, while `copySelection` shows "Select something to copy first."
(app.js:2571).

### F14 — Menu-bar commands are never greyed out, so every command looks available even when it will do nothing
File menu with nothing selected shows Copy, Cut, Paste, Rename, Move to Recycle Bin all enabled
(`disabled:false`). The app HAS a disabled+reason pattern (Paste in the background context menu
says "Copy or cut something first") but does not use it in the menu bar. This is the direct cause
of F13 being confusing.
Evidence: measured `filemenu_enabled` — all 11 entries `disabled:false`; contrast the background
context menu's `Paste … [disabled]` (app.js:2209-2210) and `Copy Folder Path … [disabled]`
(app.js:2222).

### F15 — "Copy Folder Path" in the background menu is disabled exactly when it should be enabled
In the empty-space context menu, "Copy Folder Path" is `disabled: hasSelection` (app.js:2222).
So when you have nothing selected — the one moment copying the folder path is unambiguous — it is
greyed out. When you DO have something selected, it is enabled but `copySelectedPath` then copies
the *item's* path, not the folder's. The label and the behaviour disagree.
Evidence: app.js:2222; `copySelectedPath` uses `state.selected?.path || activePath()` (app.js:1896-1899).

### F16 — Search only finds the 3 fixture index records, so "take", "scene", "V001" find nothing
A user in the real production folder types `take` or `scene` — the app answers
`Nothing matches "take".` This is expected given the stub index, but the point stands for the
real app: the index in the fixture holds 3 files while the tree holds 40+. The UI is honest
about coverage via the index bar, which is good — but the empty-search copy
`Nothing matches "take".` reads as "this folder has no such file", not "the index is tiny".
Evidence: measured `take` → `0 results`, hint `Nothing matches "take".`; fixture index is 3
records (`build-preview.py:282-308`) vs 40+ tree files.

### F17 — Empty-folder copy differs by view and one of them is bare
Column view says just `Empty`; list and icon view say `This folder is empty.` `Empty` alone is
ambiguous (empty folder? empty selection? empty result?). A folder with nothing in it should say
so in words, and ideally offer "New Folder".
Evidence: column `empty.textContent = …'Empty'` (app.js:716) vs list/icon
`'This folder is empty.'` (app.js:779, 805). Measured: column → `Empty`; list → `This folder is empty.`

### F18 — An unreadable location reports as an ordinary empty folder
Click `Data (D:)` (not mounted / not present): the app shows the folder title `D:` and the hint
`Empty` — no error banner, no explanation. A missing drive is indistinguishable from an empty
one. The error path exists (`showColumnError` app.js:1453-1460) but only fires when
`listDirectory` returns `ok:false`; the harness returns `ok:true` with no items, and the real
reader's behaviour for a missing drive is the risk.
Evidence: measured `Data (D:)` → `title:'D:'`, `hint:'Empty'`, `errBanner:null`.

### F19 — The preview pane cannot display images (or PDFs/video) in the harness, so first-run shows "This image could not be displayed."
On first run the app auto-selects the first FILE, `budget-2026.xlsx`, and the preview pane reads
`No preview for this file type.` Selecting `logo.png` shows `This image could not be displayed.`
In the real app images render from `file:///`; the harness blocks it. Flagging it because the
first thing the owner will do is open a Pictures folder and look at the preview pane — that path
needs a real-app check, and the app's fallback copy is correct but blank-looking.
Evidence: measured first-run preview body = `<p class="hint">No preview for this file type.</p>`;
`logo.png` preview → `This image could not be displayed.` (fillPane error branch app.js:1057-1059).

### F20 — The status bar and the preview info block duplicate the same facts in two places
The status bar shows `11 items · 6 folders · selected: 180 KB` and the path; the preview info
block shows Kind, Size, Where, Path, Created, Modified. Two regions, overlapping content, both
competing for the eye. The status bar's `selected: 180 KB` adds little over the info block's
`Size: 180 KB`.
Evidence: `renderStatus` app.js:397-423; `buildInfoBlock` app.js:949-996; measured both populated
simultaneously.

### F21 — Toolbar hit targets are below the 32px touch/pointer minimum; the zoom controls are 22×22
`zoomOut`/`zoomIn` measure 22×22, `back`/`forward`/`up`/`previewToggle` 28×26, the view-switch
buttons 30×24, breadcrumbs 25×17. The pillar is "beautiful, **tappable** UI"; these are not
tappable. This is the same class as the owner's "the increase/decrease buttons do nothing"
report — a control you must aim at.
Evidence: measured `X_hit` — zoom 22×22, icon buttons 28×26, seg 30×24, crumb 25×17.

### F22 — Muted text is 4.3:1 on white, just under the 4.5:1 AA threshold for body text
Status bar text, breadcrumbs, and hints use `--fg-muted: #7a7a7f` on `#ffffff` = **4.29:1**.
Fine for large text, fails AA for the 11-12px text it is actually used at. In dark mode
`--fg-muted: #98989d` on `#1c1c1e` is also borderline. The owner reads the status bar to
confirm actions.
Evidence: `--fg-muted: #7a7a7f` (style.css:19), measured computed `rgb(122,122,127)` on
`rgb(255,255,255)`; contrast ratio 4.29:1.

### F23 — Toasts have no `role="status"`/`aria-live`, and multiple toasts stack on the same pixel
Three toasts fired at once all land at the same coordinates (x≈612, y≈726) — they overlap and the
last one wins visually. And toasts carry no `role`/`aria-live`, so a screen reader never hears
"Copied 1 item." The toast is the app's ONLY confirmation channel for copy/paste/trash; it should
be announced.
Evidence: measured `toasts` all at `y:726`; `showToast` creates a plain `<div class="toast">`
(app.js:1842-1849) with no ARIA; measured `role:null, ariaLive:null`.

### F24 — Search-result column headers look sortable but are not
Search results render a `Name / Matched / Size / Date Modified` header as plain `<span>`s with no
sort affordance (app.js:508-511), while the list view's identical-looking header IS clickable
buttons with `aria-sort`. A user who learned to sort by clicking the header in list view clicks
the same header in results and nothing happens.
Evidence: `renderSearchResults` header `innerHTML` uses spans (app.js:509-511); `renderList`
header builds `<button class="list-sort">` (app.js:756-772). Measured search header buttons: 0.

### F25 — The app-local clipboard is invisible to every other program
Copy a file, then try to paste it into Explorer or a chat window: nothing. The comment explains
why (CF_HDROP needs Electron 44, app.js:2555-2561), and the in-app state is well surfaced
(paste bar + row highlight). But a Windows user's reflex is Ctrl+C in one app, Ctrl+V in another;
this copy does not exist outside the app, and nothing in the UI says "in-app only" the way the
Tags section honestly says "Kept by this app only".
Evidence: `state.clipboard` is renderer-local (app.js:2555-2565); no `clipboard.write`/CF_HDROP
path exists. Tags, by contrast, carry the "Kept by this app only" note (app.js:1262-1266).

### F26 — The app never changes the window title, so the taskbar shows a constant "Finder for Windows"
The `<title>` is static and `renderNavBar` sets only the in-window `folderTitle`
(app.js:372). Windows taskbar / Alt-Tab therefore cannot tell two windows (or two folders) apart.
Evidence: index.html:6 static `<title>`; no `document.title =` anywhere (`grep -n "document.title"`
→ none); only `el.title.textContent` (app.js:372).

### F27 — `Ctrl+F` and the View-menu "Search" focus the search box but never say where they search
Pressing Ctrl+F moves the caret into the box; the scope select ("Everywhere"/"This Folder") only
appears AFTER a search starts (`renderSearchBar` sets `scopeWrap.hidden = !showing`,
app.js:565). So the choice of scope is hidden at the exact moment the user is deciding what to
search.
Evidence: app.js:565; measured `scopeHidden` true before any search, false only once
`searchText` is set.

---

## 2. RANKED PLAN

Ranked by impact on a daily user (frequency × confusion). Size: S ≈ hours, M ≈ a day, L ≈ multi-day.

| # | Finding | One-line fix | Size |
|---|---------|--------------|------|
| 1 | **F1/F2** Back dead in column view | Call `pushHistory()` before every descend in `selectInColumn` (and on crumb/sidebar folder clicks), so Back works in every view | S |
| 2 | **F12** Ctrl+A + Delete bins 11 files, no confirm | Confirm before trashing a multi-selection; one dialog, "Move N items to the Recycle Bin?" | S |
| 3 | **F5** Filter/pattern persist across folders | Clear `kindFilter`/`pattern` in `openFolder` (as `filter` already is), or show a loud "Filtered" pill that is one click to clear | S |
| 4 | **F4** Filter blanks ancestor columns | Apply `kindFilter`/`pattern` only to the ACTIVE column, not to every column in `renderColumns` | S |
| 5 | **F10** Folder click navigates in list/icon, selects in column | Make a single click select a folder in all views; open on double-click/Enter (column view already previews on select) | M |
| 6 | **F11** Folder trash missing from right-click but live elsewhere | Add "Move to Recycle Bin" to the folder context menu (the recursive-delete concern is about folders' contents, not the action) OR remove it from the File menu too — pick one truth | S |
| 7 | **F13/F14** Rename/Open silent with no selection; menus never greyed | Grey out commands with no valid target and set the existing `note` reason; make Rename/Open toast "Select an item first." | S |
| 8 | **F7** Folder listing not keyboard-reachable | Give rows `tabindex="0"` (roving tabindex), wrap the listing in `role="listbox"`, announce selection | M |
| 9 | **F9** Menu bar not keyboard-operable | Add `role="menubar"`, `aria-haspopup`, `aria-expanded`; Escape closes; Arrow keys move within the open menu (reuse the context-menu handler) | M |
| 10 | **F8** Shortcut sheet missing the 5 most common keys | Add Copy/Cut/Paste/Select All/Refresh rows to `showShortcuts` | S |
| 11 | **F3** "Back to Folder" filed under View | Move it to the Go menu (and keep Esc), so the "where am I / how do I get back" menu is one place | S |
| 12 | **F17/F18** `Empty` vs `This folder is empty.`; unreadable drive looks empty | Use one sentence everywhere and add a "New Folder" action; distinguish "cannot read this location" from "empty" | S |
| 13 | **F23** Toasts unannounced and overlapping | `role="status"` + `aria-live="polite"`; stack toasts with a small offset so they don't collide | S |
| 14 | **F21** Sub-32px hit targets | Raise icon-button/seg/zoom hit areas to ≥32×32 (padding, not icon size) | S |
| 15 | **F22** Muted text 4.29:1 | Darken `--fg-muted` to meet 4.5:1 (≈ #6b6b70 light; ≈ #a6a6ab dark) | S |
| 16 | **F24** Search headers look sortable | Either make them sort (reuse list header) or drop the column affordance in results | S |
| 17 | **F6** Pattern-bar buttons ambiguous | Rename to "Clear name filter" / "Show all types", or collapse to one "Clear filters" | S |
| 18 | **F15** "Copy Folder Path" disabled when it should be live | Invert the flag; when a selection exists, label it "Copy Item Path" so label matches behaviour | S |
| 19 | **F26** Static window title | `document.title = baseName(activePath)` so the taskbar/Alt-Tab identify the folder | S |
| 20 | **F27** Scope hidden until after search | Show the scope select whenever the search box has focus | S |
| 21 | **F20** Status bar duplicates the info block | Drop `selected: <size>` from the status bar (the info block already says Size); keep item/folder counts | S |
| 22 | **F19** Preview blank for image/xlsx first-run | Verify image/PDF/video preview in the real app; if fine, add a one-line "no preview" affordance that points at Open | S |
| 23 | **F25** In-app-only clipboard unlabelled | Add a "Copies stay inside this app" note near the paste bar, mirroring the Tags honesty | S |
| 24 | **F16** Search finds only indexed files | Index bar already warns; sharpen the empty-result copy to name the index scope ("nothing in the 3 indexed files") | S |

---

## 3. DELETION CANDIDATES

Argued, because deletion is the step that leaves no artifact.

1. **The type Filter dropdown, as a separate control from the name-pattern bar.** Both live in
   the toolbar, both narrow the same list, both have their own Clear button, and they are usually
   used together ("video" + "V003"). The pattern bar already subsumes most of the Filter's value
   for the owner's real folder. Candidate: delete the separate Filter button and fold kind into
   the same bar as chips. Kept for now because "show me only the videos" is a genuinely different
   question; if it survives, it should move INTO the pattern bar rather than sit beside it.
2. **The `state.filter` field (app.js:72, 241, 253).** It is dead: nothing in the UI sets it, and
   it is only ever read. `openFolder` clears it (app.js:1405) for no reason. Delete the field and
   its reads (app.js:241, 253, 716, 779, 805) — the empty-state branches that test it can never be
   true. This removes four confusing "is it filtered?" conditionals.
3. **The Index coverage bar (`#indexbar`).** It occupies a full-width row above the breadcrumb,
   permanently, on first run and after every scan, to say "Index covers 3 files". For a
   file manager whose pillar is "fast on huge folders", a permanent coverage banner is
   chrome that competes with the folder. Candidate: delete the always-on bar; show coverage only
   inside the search results view, where it is actually relevant. Kept conditionally — the
   honesty is right, the placement is not.
4. **The "Show all types" button in the pattern bar (index.html:128).** Redundant with the
   Filter button's own "Show All Types" entry in its menu. Two controls that do the same thing
   in the same 40px of screen. Delete one.
5. **The status bar's `selected: <size>` segment (app.js:410-412).** Duplicates the preview
   info block's Size row. Delete from the status bar; the status bar should answer "how many",
   the info block "what is it".
6. **The zoom percentage readout `100%` (index.html:95).** It is a label between two buttons
   that tells you a number nobody acts on, and it is the one control whose "did it work?" the
   owner has already questioned. Candidate: delete the readout and make the +/- buttons' effect
   self-evident (the whole UI scales — no label needed). Kept if user testing shows the label is
   the only proof it worked.
7. **The `#indexDismiss` / `#indexAction` pair as two buttons in a banner.** If the index bar is
   kept, one button + a close affordance is enough; "Build Index" and "Stop" as one button whose
   label flips is already the pattern (app.js:640-646), so the separate Dismiss is the extra.

Nothing else is a deletion candidate: selection, the four views, Quick Look, the preview info
block, tags, and the copy/paste state are all load-bearing and well built (see §4).

---

## 4. WHAT IS ALREADY GOOD — do not churn this

- **Selection model.** Single click, Ctrl+click (add/remove), Shift+click (range from a real
  anchor), Ctrl+A, Shift+Arrow extend — all measured working, with a separate "lead" item so the
  preview/status always have a definite subject (app.js:1462-1535). Ctrl+A selected all 11 and
  said `11 items · 6 folders`. This is correct; do not rewrite it.
- **Copy/Cut/Paste with visible state.** Copy → toast `"logo.png" copied.` + row highlight +
  paste bar `1 copied — Ctrl+V to paste here`; navigate; paste → the file actually arrived
  (`window.__transfers` recorded the copy) and the toast said `Copied 1 item.` Cut consumes the
  clipboard on paste. This is better than most file managers; keep it.
- **The context menu architecture.** One command list, reused by menu bar / right-click / keyboard,
  with `role="menu"`/`role="menuitem"` and full arrow/Escape/Enter keyboard support
  (app.js:3127-3143). Copy/Cut labels name the batch size ("Copy 5 Items"). This is the model the
  MENU BAR should copy (F9), not the other way round.
- **Right-click selects first.** Right-clicking an unselected item selects it before opening the
  menu (app.js:2922-2938) — the single most jarring context-menu bug, correctly avoided.
- **Tags.** Right-click → Tags… → the 7-colour picker, ticked when held, toggling to remove; the
  sidebar shows a count, a coloured dot, and the honest "Kept by this app only" note; the empty
  state says "Right-click a file to add one." Clicking a tag shows its files. Measured end to end.
- **Quick Look.** Space opens a full-screen look; `←`/`→` step and re-render the overlay onto the
  new file (the bug the comment says it fixed — verified: it opens on `scene-01-take-01.mp4` and
  steps to `scene-01-take-02_VO.mp4`); Escape closes; the end-of-folder is announced
  ("That is the last file here."). Stepping uses `presentItems`, so it honours the filter.
- **Preview pane info block.** Kind/Size/Where/Path/Created/Modified, with Where and Path
  click-to-copy, dimensions appended once the image loads, and a folder shows its contents plus a
  count. The pane is ON by default and has a visible toggle — the owner's "I saw no previews" is
  fixed and findable.
- **Sort.** Menu with ✓ and ↑/↓ on the active key; list-view headers sort with `aria-sort`; the
  toolbar label always states the order (`Name ↑`). Folders stay above files; ties break by name
  so order never flickers. Measured working.
- **The name-pattern bar for the shot-naming case.** Type `V003` in a 9-file version folder and
  it narrows to the 2 matching takes, with the status bar saying `2 items · filtered from 9`.
  This is the owner's real folder, and it works.
- **Empty search state.** `Nothing matches "shot".` plus a scope-aware summary
  `2 results for "shot" everywhere` and a "Back to Folder" button. Search results show the
  enclosing folder and whether the match was Name or Contents — a result with no location is
  unusable, and this avoids that.
- **Zoom actually scales.** Clicking +/- moved the label 100→110→90% AND changed a row's height
  26→29→23px with `documentElement.zoom` applied — the owner's "buttons do nothing" is
  measurably fixed.
- **No page errors anywhere.** 202-check suite green, zero console errors in every scenario driven.
