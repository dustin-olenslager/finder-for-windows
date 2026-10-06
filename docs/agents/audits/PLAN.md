# The final UI/UX work — consolidated plan

Four specialist audits were run against the real application (v0.13.0), each driving the
actual renderer rather than reading the source: **interaction**, **visual design**,
**Windows nativity**, and **accessibility / robustness / honesty**. Their full reports are
beside this file (`sme-*.md`). This is the merge.

**Method note.** Every finding below carries evidence in its source report — a file:line, a
measured pixel value, a computed contrast ratio, or the exact key sequence that fails. The
accessibility audit measured contrast from computed colours; the performance and visual
claims were measured, not eyeballed, and where a vision read disagreed with a measurement
the measurement won. All four audits were read-only.

**Corroboration is the priority signal.** Several findings were reached independently by two
audits starting from different questions. Those are ranked first, because two independent
methods agreeing is much stronger evidence than one method asserting.

---

## The short version

The structure is right and the hard parts are built. What is left is three different kinds
of "not finished":

1. **Things that are wrong** — a few real defects, including two that are dishonest.
2. **Things nobody can reach** — keyboard-only and screen-reader users are blocked outright.
3. **Things that look like a web page** — no drag and drop, no real file icons, no undo.

---

## P0 — Correctness and honesty

These are defects. Several are dishonest, which matters more than cosmetic work: an app that
reports success while destroying data is worse than one that is ugly.

| # | What a person experiences | Fix | Size | Found by |
|---|---|---|---|---|
| 1 | A file on a **mapped network drive** is permanently deleted, and the app says "moved to the Recycle Bin". Data loss reported as success. | Use the `DriveType === 4` value the drive adapter already reads to mark mapped drives, and have the trash path refuse them exactly as it already refuses UNC paths. | M | a11y + win |
| 2 | **Back is dead in column view** — the default view. Click into a folder and the Back arrow never becomes usable. | Call `pushHistory()` before every descend in `selectInColumn`, and on breadcrumb/sidebar folder clicks. | S | interaction |
| 3 | A **failed search says "Nothing matches"** — the error is written to state three times and never rendered. | Render `state.searchError` in the results view. | S | a11y |
| 4 | A **rejected IPC** leaves the previous folder on screen, or "Loading…" forever. The app looks like it worked. | Wrap the column read and the first paint in `try/catch` and render the same error banner. | M | a11y |
| 5 | **"Empty" is printed under a permission-denied banner** — two contradictory statements at once. | Render the error *instead of* the empty state. | S | a11y |
| 6 | **Ctrl+A then Delete bins the entire folder contents with no confirmation.** | Confirm a multi-selection trash with one dialog naming the count. | S | interaction + a11y |
| 7 | Turning on a filter makes the **folder you came from look empty** (ancestor columns are filtered too). | Apply kind/pattern filters to the active column only. | S | interaction |
| 8 | Filters and the name pattern **persist across folders**, so the next folder opens showing "0 items". | Clear them on folder open, or show a loud one-click "Filtered" pill. | S | interaction |
| 9 | With nothing selected, **Rename and Open do nothing at all** — no message. Menu commands are never greyed out, so everything looks available. | Grey out commands with no valid target using the `note` reason already in the model; toast "Select an item first." | S | interaction + a11y |
| 10 | **"Move to Recycle Bin" is missing from the folder right-click menu** but present in the File menu and on the Delete key. | Pick one truth. | S | interaction |
| 11 | A watched file that disappears is never mentioned. | One status line when a live refresh drops the lead item. | S | a11y |

---

## P1 — Keyboard and screen reader

**Every keyboard-only user is blocked today, and every screen-reader user is blocked today.**
This is the largest group of people affected by any single category in this plan, and most of
the fixes are a handful of lines each.

| # | What a person experiences | Fix | Size |
|---|---|---|---|
| 12 | **Tab never reaches a file row.** Arrow keys work only after a mouse click, so the app cannot be driven without one. | One tab stop on the content area plus roving `tabindex`, focusing the selected row on render. | S |
| 13 | **The global Enter/Space handler hijacks focused buttons.** Enter on the Up button opened a spreadsheet; sidebar and toolbar buttons are Enter-inert. | Return early from the global key handler when the event target is a button, input or select. | S |
| 14 | **The menu bar is mouse-only** — Enter/Space/ArrowDown do nothing, so Sort, Filter, Tags, Go and Build Index are unreachable by keyboard. | `role="menubar"`, `aria-haspopup`/`aria-expanded`, arrow navigation, Escape closes and restores focus. | M |
| 15 | **Escape closes only the context menu.** The menu bar, the dropdowns and the shortcuts sheet stay open, and `aria-expanded` is left lying. | Extend the Escape branch to any open panel; reset `aria-expanded` on close. | S |
| 16 | **File rows announce as nothing.** `role="option"` with no `listbox` parent is dropped by Chromium — the accessibility tree has zero options. | Make the listing a real listbox, or a list, with an accessible name per row. | M |
| 17 | **Toasts are not announced**, and two toasts stack on the same pixel. | `role="status"` + `aria-live="polite"` on a node that outlives the removal; offset the stack. | S |
| 18 | Selection changes and the item count are **not announced**. | One stable status line: "logo.png, 2 of 11, selected 180 KB". | S |
| 19 | Ctrl+Arrow does not extend the selection; Home/End/PageUp/PageDown do nothing. | Route them through the existing ctrl branch of the selection handler. | S |
| 20 | Quick Look claims `aria-modal` without trapping focus, and focus never enters it. | Move focus in, label it by the filename, make the background inert — or stop claiming modality. | S |
| 21 | The shortcuts sheet is not a dialog and Escape does not close it. | `role="dialog"`, `aria-modal`, labelled, Escape closes. | S |
| 22 | **The shortcut sheet omits the five keys people most need**: Copy, Cut, Paste, Select All, Refresh. | Add the rows. | S |

**Smallest change with the largest reach:** items 12, 13 and 17 together turn the app from
"mouse required" into "keyboard usable with spoken feedback" for most of the findings above.

---

## P2 — Visual correctness

Cheap, high-visibility, and mostly one root cause each.

| # | What a person sees | Fix | Size | Found by |
|---|---|---|---|---|
| 23 | The **toolbar title is off-centre** — 39.5px at 100%, and 352px adrift at 150%. | Replace the two `flex:1` groups with a three-column grid. | S | visual |
| 24 | **Light mode fails AA on ten surfaces** from one token: status bar 4.12, hints 4.00, placeholders 3.75, accelerators 4.27, badges 3.85. | Darken `--fg-muted` to about `#5f5f66` and add a real dim tier. One change fixes all ten. | S | visual + a11y + interaction |
| 25 | **Five design tokens are never defined** — ten `var(..., fallback)` sites render the fallback instead. In light mode tag hover is 1.00:1, i.e. invisible. | Define `--accent-soft`, `--bg-soft`, `--hover`, `--line-soft`, `--fg-dim` in both themes, derived from the real ramp. | S | visual |
| 26 | **Focus is invisible on nine classes**, and invisible *on selected items* (1.00:1 light, 1.85:1 dark). The search input has no ring at all. | Add `:focus-visible` to the nine classes; use a ring that contrasts with the fill as well as the background. | S | visual + a11y |
| 27 | Disabled controls are effectively invisible — 2.73:1 dark, 2.03:1 light. | Replace `opacity: .45` with a real disabled colour at 3:1 or better. | S | visual + a11y |
| 28 | The list view's **Name header sits 24px left of the filenames** it labels. | Move it into the grid column that holds the names. | S | visual |
| 29 | **The icon set looks borrowed**: seven stroke widths, four sizes, mixed fill and outline, and three kinds fall back to a blank page. | One stroke width per size, one size scale, one fill rule; add the missing glyphs. | M | visual |
| 30 | Size and date columns are left-aligned, so the numbers do not line up for scanning. | Right-align them; tabular figures are already set. | S | visual |
| 31 | The empty state is a 14px caption in a corner rather than a composed state. | Centre it. | S | visual |

---

## P3 — Native: stop feeling like a web page

Four tells make it read as "a web page in a window frame": nothing can be dragged, nothing
can be dropped on it, the file clipboard does not talk to Explorer, and every row shows the
same generic page glyph.

| # | What a person experiences | Fix | Size | API |
|---|---|---|---|---|
| 32 | **You cannot drag a file out** to Explorer, Mail, or anything else. | `webContents.startDrag` | M | in 43 |
| 33 | **You cannot drag a file in** — onto a folder row, the listing, or a sidebar folder. | renderer `dragover`/`drop` + `webUtils.getPathForFile`, feeding the existing transfer use case | M | in 43 |
| 34 | **Every row shows the same generic glyph** — no real file-type icons, no thumbnails. | `app.getFileIcon` + `nativeImage.createThumbnailFromPath`, cached by extension, skipping cloud placeholders | M | in 43 |
| 35 | **There is no undo.** | An app-local journal of the last operation, beside the index store | M | none needed |
| 36 | **Copy here does not paste in Explorer**, and vice versa — and the pinned Electron cannot fix it. | Requires Electron **44+** for `ClipboardItem` / CF_HDROP | M | **needs upgrade** |
| 37 | A name collision is **refused rather than resolved**. | Replace / Skip / Keep both — `suggestUniqueName` is already written and unused | S | none needed |
| 38 | "Open in Windows Explorer" cannot open **the folder you are in**, only a selection. | `shell.openPath` on the current directory | S | in 43 |
| 39 | The app **forgets its window size and position**, and cannot be opened *on* a folder. | Persist bounds; `requestSingleInstanceLock` + argv | S | in 43 |
| 40 | No hidden/system-file toggle, though the data is already computed for every item. | App-local filter plus a View entry | S | none needed |
| 41 | Typing letters does not jump the selection. | Renderer only | S | none needed |
| 42 | No "Open with…". | `rundll32 shell32.dll,OpenAs_RunDLL` | S | in 43 |
| 43 | A long operation has **no progress and no cancel**. | Per-item progress + abort token, driving the taskbar | L | `setProgressBar` |
| 44 | Paths over 260 characters are reported as failures, never worked around. | The `\\?\` extended-length prefix at the filesystem boundary | M | none needed |

---

## P4 — Composition and motion

| # | Change | Fix | Size |
|---|---|---|---|
| 45 | **134px of chrome before the first file**, with five stacked hairlines. | Fold the breadcrumb into the toolbar and drop the in-window menu bar (see deletions). | M |
| 46 | The preview pane **echoes the column beside it** — for a folder it lists the same children, narrower, in a different order. The clearest "unfinished" tell. | For a folder, show metadata and a count only. | S |
| 47 | No spacing, type or radius scale — nine gaps, six radii, seven sizes, one of them the browser's default. | Collapse to 4/8/12, 4/6/8, and a real type scale; delete the literals. | M |
| 48 | **Motion is essentially absent** — one transition in the whole app, and no reduced-motion block, though motion is a stated design pillar. | One shared duration/easing, a hover transition, a spring-loaded folder open, and a `prefers-reduced-motion` block that zeroes it. | M |
| 49 | The index coverage bar is always on, narrating an internal process. | Show it only while indexing; move the idle summary to a tooltip. | S |
| 50 | Long toast text runs 590px wide with no cap. | Cap the width and wrap. | S |

---

## Deletions — what to remove instead of refine

Deletion is the step that leaves no artifact, so it is recorded here explicitly. Each entry
says what happens to it and why.

**Remove:**

| Candidate | Why |
|---|---|
| The `state.filter` field and its reads | Dead: nothing in the UI sets it. Its empty-state branches can never be true. Removing it deletes four confusing conditionals. |
| The "Show all types" button in the pattern bar | Duplicates the Filter dropdown's own entry, in the same 40px of screen. |
| `labelForLetter` / `volumeName` in the drive adapter | Dead code — never called, never tested, and `volumeName`'s whole body is `return null`. |
| The `aria-sort` attribute on list headers | Inert where it is used (it belongs on `columnheader`/`th`). Measured: the node exposes no sort property. **The repo's own suite asserts the attribute and passes** — a test that certifies a lie is worse than no test. The state is already in the button's accessible name. |
| The `Where` row in the info block | It is the path minus its last segment: two rows saying one thing. |
| The index bar's idle state | Keep the honesty, move it to where it is relevant. |
| The preview pane's folder child-listing | Duplicates the adjacent column. |
| The in-window menu bar | Finder has none. The toolbar and the context menu already make features findable, which was its whole purpose. Removes 26px and one hairline. *If discoverability is the named requirement, keep a single Help "?" in the toolbar — not a four-item bar.* |
| The status bar's duplicate `selected: <size>` | The info block already says Size. |
| `role="option"` on rows, **as shipped** | The role is invalid without a `listbox` ancestor, so Chromium drops it — the code looks accessible while the screen reader hears nothing. Promote it into a real listbox, or delete it. Do not leave it as decoration. |

**Removed because forbidden or wrong:**

| Candidate | Why |
|---|---|
| File-type associations / registering as a default handler | FR-035 and the owner's decision: the app must not change system-wide associations. "Open with…" gives the useful half without the hostile half. |
| Changing Explorer's own settings | Same rule. The hidden-file toggle is app-local on purpose. |
| An in-app Recycle Bin view | Enumerating the bin needs an unreliable COM or `$Recycle.Bin` parse. |

**Deferred, not removed:**

| Candidate | Why |
|---|---|
| Put Back *from* the Recycle Bin | No supported API. The journal undo covers the real accident — the file deleted here. Revisit only if someone asks to restore files *Explorer* deleted. |
| Replacing the HTML menu bar with a native application menu | Real gain is small; the HTML bar is discoverable and already holds state. Only worth it with a second window. |

---

## What is already good — do not churn it

Recorded so the final pass does not undo it: the **selection model** and its two-tier
lead/selection design; **copy/cut/paste state** and its visible cut dimming; the
**context-menu architecture**; the **tags** store and UI; **Quick Look stepping**; the
**preview info block**; **sort**; the **name-pattern bar**; the **empty-search** state; the
**dark theme**; **column geometry**; **tabular figures**; **right-to-left path rendering**;
the **no-bare-spinner** rule; the **verified clipboard read-back**; **partial-failure
reporting** ("2 of 3 done", with the error named); the **UNC Recycle-Bin refusal**; the
**Windows path domain layer**; **one-PowerShell-call folder enumeration**; the **4-second
drive-enumeration timeout**; **never-clobber at three layers**; and **case-only rename**
handling.

---

## Suggested landing order

1. **P0** — correctness and honesty. Small, and two of these are data-loss lies.
2. **P1** — keyboard and screen reader. Largest group of blocked people; mostly small.
3. **P2** — visual correctness. One root cause each; immediately visible.
4. **P3** — native. The four "web page" tells first (32, 33, 34, 35).
5. **P4** — composition and motion, after the deletions above have reclaimed the space.
