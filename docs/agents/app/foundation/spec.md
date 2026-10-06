# Spec: Finder for Windows — foundation and the v1 experience

- **Area:** `app` · **Started:** 2026-10-05 · **Status:** Draft
- **Owner:** Dustin Olenslager (owner and domain practitioner)
- **Plan:** `plan.md` in this folder — written only AFTER every `[NEEDS CLARIFICATION: …]` below is
  resolved. _(The spec says what and why; the plan says how.)_
- **Decisions of record:** `docs/agents/decisions/0001-open-decisions.md` (D-0001 … D-0010). A
  requirement here that contradicts that file is a defect.

## Goal

Someone who has used a Mac for years and now works on Windows can browse, find, preview, organize and
tag their files the way they already do on a Mac — without relearning how a file manager works and
without giving up the things Finder does that Windows Explorer does not. After this ships, that
person opens one window, moves through folders by click or keystroke, sees any file without opening
it, finds a file by something they remember about it (its name, or a word inside it), marks files
with color-coded tags, and never has to think about which operating system they are on.

The one thing that must be true: it must never feel like a Windows Explorer skin. It should feel like
Finder that happens to be running on Windows.

## User stories

### US-1 — Move through folders the way Finder does (P1)

A person opens the app, lands in a folder, and navigates: the sidebar shows Favorites, a Tags
section, and Locations (drives and network shares). They click a folder in the sidebar and the
content pane shows it. Clicking a folder in the content pane drills into it; the toolbar's back and
forward buttons and the keyboard both walk the history. The path is always visible as a breadcrumb at
the bottom.

- **Why this priority:** nothing else matters if you cannot get to your files. This is the smallest
  slice that is genuinely useful on its own, and it establishes the IPC bridge, the directory
  listing, and the navigation history that every later story builds on.
- **Independent test:** launch the app, click three folders deep via the sidebar and the content
  pane, then walk back to the start with the back button and with the keyboard — the same folder is
  shown at each step and the breadcrumb matches.
- **Acceptance scenarios:**
  1. **Given** the app is open on the user's home folder, **when** they click a folder in the
     sidebar, **then** the content pane lists that folder's contents and the breadcrumb updates.
  2. **Given** the user has navigated three folders deep, **when** they press the back shortcut,
     **then** they return to the previous folder and forward returns them again.
  3. **Given** a folder containing 100,000 entries, **when** it is opened, **then** the window
     paints the first screen of entries immediately and stays responsive while the rest load.

### US-2 — See any file without opening it (P1)

The user selects a file and presses the spacebar. A preview appears instantly over the window — an
image, a PDF, a video, a text or code file, a document. With the preview open, the arrow keys move to
the next or previous file and the preview follows, without closing. Pressing spacebar again closes
it.

- **Why this priority:** it is the single behavior people mean when they say "Finder". It is also
  independently testable and does not depend on tags or search.
- **Independent test:** select an image, press spacebar, confirm the preview renders; press the down
  arrow and confirm the preview switches to the next file while staying open; press spacebar again
  and confirm it closes.
- **Acceptance scenarios:**
  1. **Given** a folder with mixed file types, **when** the user presses spacebar on a PDF, **then**
     its first page renders without opening an external application.
  2. **Given** the preview is open on a file, **when** the user presses the down arrow, **then** the
     preview shows the next file in the current view order and remains open.
  3. **Given** a file type with no built-in renderer, **when** the user previews it, **then** they
     are offered "Open with the default app" instead of an error or a blank panel.

### US-3 — Find a file by its name, its kind, or a word inside it (P1)

The user types into the search field. Results appear as they type, in the normal view rather than a
separate results pane. They can narrow to the current folder or widen to everything indexed. They can
search inside file contents. They can save a search so it appears in the sidebar and re-runs itself.

- **Why this priority:** the owner ranked this the single most valuable capability and chose to bring
  content indexing into v1 (D-0003, D-0009). It is also the largest engineering cost, so it is
  specified here rather than assumed.
- **Independent test:** create a text file containing a rare nonsense word in a scratch folder, wait
  for the index to observe it, search for that word, and confirm the file is returned — then confirm
  the same search restricted to the current folder behaves as scoped.
- **Acceptance scenarios:**
  1. **Given** the index has covered a folder, **when** the user types a word that appears only
     inside a file, **then** that file appears in the results.
  2. **Given** results are showing, **when** the user switches the scope to the current folder,
     **then** only matching items inside that folder remain.
  3. **Given** a useful search, **when** the user saves it, **then** it appears in the sidebar under
     a Saved Searches section and returns the same results when clicked later.

### US-4 — Organize with color-coded tags (P2)

The user assigns one or more named, color-coded tags to a file or a selection. Tags appear as colored
dots beside the filename in every view. The sidebar has a Tags section; clicking a tag shows
everything carrying it. Tags can be renamed, recolored, added and removed.

- **Why this priority:** high value, but it is not required to browse, preview or search, so it
  follows them.
- **Independent test:** tag a file with two tags, confirm both dots render beside its name, click one
  tag in the sidebar and confirm the file is listed, then remove a tag and confirm the dot and the
  sidebar listing update.
- **Acceptance scenarios:**
  1. **Given** a file with no tags, **when** the user assigns two tags, **then** two colored dots
     appear beside its name in every view.
  2. **Given** the sidebar's Tags section, **when** the user clicks a tag, **then** every item
     carrying that tag is listed, regardless of which folder it lives in.
  3. **Given** a tagged file is renamed or moved within the same drive, **when** the user looks at
     its new location, **then** its tags are still attached.

### US-5 — Open a folder and have it look the way it looked last time (P2)

Every folder remembers how the user last viewed it — which view mode, what it was sorted by, how big
the icons were, and where icons were placed — and reopens that way.

- **Why this priority:** this is the quiet behavior that makes a filesystem feel like the user's own
  rather than a generic listing. It is independent of tags and search.
- **Independent test:** set a folder to list view sorted by date, close the window, reopen the
  folder, and confirm it is still list view sorted by date.
- **Acceptance scenarios:**
  1. **Given** a folder in icon view with large icons, **when** the user returns to it later, **then**
     it opens in icon view with large icons.
  2. **Given** a folder on read-only media where the preference cannot be stored beside it, **when**
     the user changes the view, **then** the change is still remembered for the session and no error
     is shown.

### US-6 — Manage files with confidence, and undo a mistake (P2)

The user copies, moves, renames, duplicates, creates folders and deletes — including whole
selections — and can undo the last operation. Deleted items go to the Windows Recycle Bin and can be
put back where they came from.

- **Why this priority:** a file manager that cannot safely move files is not a file manager. It
  follows the read-only stories because it carries the most risk of data loss.
- **Independent test:** move a file into a subfolder, undo, and confirm it is back in its original
  folder; then delete a file, confirm it is in the Recycle Bin, and put it back.
- **Acceptance scenarios:**
  1. **Given** a file is moved to another folder, **when** the user undoes the operation, **then** the
     file is back in its original folder with its original name.
  2. **Given** the user deletes a file, **when** they open the Windows Recycle Bin, **then** the file
     is there.
  3. **Given** the user has deleted a file, **when** they choose Put Back in the app, **then** the
     file returns to its original folder.

### US-7 — Switch between four views, including Finder's column view (P2)

The user switches between Column, Icon, List and Gallery views, from the toolbar or the keyboard.
Column view is the default for a folder with no remembered state.

- **Why this priority:** the owner chose Column as the default (D-0002) because it is the
  Finder-defining view and the hardest to retrofit. It is separable from the rest.
- **Independent test:** open a never-visited folder and confirm it opens in column view; switch to
  each of the other three and confirm the content renders correctly in each.
- **Acceptance scenarios:**
  1. **Given** a folder that has never been opened, **when** the user opens it, **then** it is shown
     in column view.
  2. **Given** column view, **when** the user selects a folder in a column, **then** a new column
     appears to its right listing that folder's contents, and the previous columns remain.
  3. **Given** column view, **when** the user drags a column divider and later returns, **then** the
     column widths are as they left them.

### US-8 — See the details of a selection (P3)

The user opens an information panel for one item or a multi-selection and sees name, kind, size,
dates, where it lives, which app opens it, and its tags — and can edit the name and tags from there.

- **Why this priority:** valuable and expected, but not required for the core journey.
- **Independent test:** select three files, open the info panel, confirm it reports the combined size
  and the item count, then rename one from the panel and confirm the change appears in the list.
- **Acceptance scenarios:**
  1. **Given** three files are selected, **when** the user opens info, **then** one panel reports the
     item count and the combined size.
  2. **Given** the info panel is open on a file, **when** the user edits its tags, **then** the change
     is reflected in the list without reopening the panel.

## Edge cases

- **A folder the user cannot read.** Permission-denied folders show an explanatory state, not an
  empty list and not a crash.
- **A file that cannot be created on Windows.** Names that NTFS rejects (reserved names, forbidden
  characters, trailing dots or spaces) and paths past the long-path limit must surface as a clear
  "this cannot be created here" state — a folder tree that exists on a Mac may be impossible here.
- **A file that is a cloud placeholder.** Reading it triggers a download. Enumeration, sorting,
  thumbnailing and indexing MUST NOT silently hydrate cloud-only files; a cloud badge is shown until
  the user explicitly opens it.
- **A network share that disappears mid-session.** The window shows the share as unavailable and
  stays usable; it does not hang.
- **A huge folder.** 100,000 entries must not freeze the window; the first screen paints and the rest
  stream in.
- **A file changes while it is being listed.** The view updates without the user reloading.
- **The same operation arrives twice** (a double-click on Move, or a retried delete) — it must not
  move or delete twice.
- **An undo after the app restarts** — the operation journal is persisted, so undo survives a
  restart, or the user is told plainly that it does not.
- **A tag on a file that has been deleted outside the app** — the tag entry is reconciled away rather
  than pointing at nothing.
- **A file that is open in another program** — move and delete report a clear, specific error rather
  than a generic failure.
- **A search typed while the index is still building** — results are returned from what is indexed,
  and the user is told the index is still catching up.

## Requirements

- **FR-001**: The app MUST present a single-window file browser with a sidebar, a content pane, a
  toolbar, a breadcrumb path bar and a status area showing item count and free space.
- **FR-002**: The sidebar MUST contain Favorites (user-managed), a Tags section, and a Locations
  section listing drives and mounted network shares.
- **FR-003**: A user MUST be able to drag a file onto a sidebar row and have it moved or copied
  there.
- **FR-004**: The app MUST provide Column, Icon, List and Gallery views, switchable from the toolbar
  and by keyboard, with Column as the default for a folder with no remembered state.
- **FR-005**: Column view MUST show cascading columns, with the rightmost column previewing the
  selected item, and MUST remember per-window column widths.
- **FR-006**: The app MUST remember, per folder, the view mode, sort order, icon size and icon
  positions, stored in a hidden sidecar file beside the folder, falling back to a central store when
  the folder is not writable.
- **FR-007**: The app MUST support marquee selection, Ctrl-click to toggle an item, Shift-click for a
  range, and select-all.
- **FR-008**: The app MUST preview a file on the spacebar without opening an external application,
  covering images, PDF, video, audio, plain text and code, and Office documents; it MUST offer the
  default application for anything it cannot render.
- **FR-009**: With a preview open, arrow keys MUST move to the next or previous file and the preview
  MUST follow without closing.
- **FR-010**: The app MUST provide a search field in every window that returns results as the user
  types, shown in the normal view rather than a separate results pane.
- **FR-011**: Search MUST cover file names, file kind and dates, and MUST cover text inside files.
- **FR-012**: Search MUST be scoped to either the current folder or the whole index, selectable by
  the user.
- **FR-013**: A user MUST be able to save a search; saved searches MUST appear in the sidebar and
  re-run when selected.
- **FR-014**: A user MUST be able to assign one or more named, color-coded tags to a file or a
  selection, remove them, and rename or recolor a tag.
- **FR-015**: Tags MUST render as colored dots beside the filename in every view.
- **FR-016**: Tags MUST be stored in an application-managed database keyed by volume and file
  identity with a path-based fallback, so a tag survives a rename or a move within the same volume
  and works on filesystems without extended-attribute support.
- **FR-017**: The app MUST state plainly, in the interface, that tags are visible only inside this
  application.
- **FR-018**: A user MUST be able to copy, move, duplicate, rename (single and in batch), create
  folders, and delete, on single items and on multi-selections.
- **FR-019**: Deleting MUST send items to the Windows Recycle Bin, and the app MUST offer Put Back to
  the recorded original location.
- **FR-020**: The app MUST journal file operations and support undoing the most recent one, including
  after a restart.
- **FR-021**: The app MUST show a progress indication for long copy, move and delete operations and
  MUST allow cancelling them.
- **FR-022**: The app MUST resolve name collisions during copy and move by asking the user (replace,
  skip, keep both) rather than overwriting silently.
- **FR-023**: The app MUST provide an information panel for a single item or a multi-selection,
  reporting name, kind, size, dates, location, default application and tags, and allowing the name
  and tags to be edited there.
- **FR-024**: The app MUST provide the keyboard map recorded in D-0005 — `F2` rename, `Delete` to
  trash, `Ctrl+Shift+N` new folder — as the single documented shortcut map, and MUST NOT mix it with
  a second grammar.
- **FR-025**: The app MUST keep the interface responsive when a folder contains 100,000 entries,
  painting the first screen before the full listing completes.
- **FR-026**: The app MUST update a listing when its contents change on disk, without a manual
  refresh, and MUST recover from a watcher buffer overrun by re-listing.
- **FR-027**: The app MUST NOT read the contents of a cloud-placeholder file during enumeration,
  sorting, thumbnailing or indexing, and MUST indicate that such a file is not local.
- **FR-028**: The app MUST build and maintain a search index over the user's drives, excluding
  system directories, and MUST extract text from plain text and code, PDF, Office documents, and
  images.
- **FR-029**: The app MUST meet the index performance budget in D-0010: warm queries within about
  200 milliseconds, and a first full scan of roughly one million files within about one hour.
- **FR-030**: The app MUST report indexing state to the user — what is covered, what is still
  building, and whether the index is paused.
- **FR-031**: The app MUST let the user pause and resume indexing and exclude folders from it.
- **FR-032**: The app MUST surface permission-denied and unavailable-location states as explanatory
  messages rather than empty lists or crashes.
- **FR-033**: The app MUST report unsupported names and over-long paths as a clear "cannot be created
  here" state.
- **FR-034**: The app MUST be delivered as an unsigned installer for Windows on ARM64, with an x64
  build produced from the same source.
- **FR-035**: The app MUST NOT modify Windows Explorer's settings, register itself as the default
  file manager, or change any system-wide file association.
- **FR-036**: The app MUST retain the user's data — tags, saved searches, per-folder view state,
  operation journal and index — across application updates.
- **FR-037**: The app MUST provide a way to open the current folder in Windows Explorer, as an escape
  hatch.
- **FR-038**: The app MUST show a thumbnail for images and video in the icon and gallery views, and a
  type-appropriate icon otherwise, without blocking the interface while thumbnails generate.

## Key entities

- **File item** — one entry in a folder: its name, kind, size, timestamps, attributes, whether it is
  local or a cloud placeholder, and its identity on its volume. A file item belongs to exactly one
  folder at a time.
- **Folder** — a container of file items, with its own remembered view state. Folders nest.
- **Tag** — a named, color-coded label. A file item may carry several; a tag may be on many items.
- **Saved search** — a stored query plus its scope, listed in the sidebar.
- **View state** — the view mode, sort order, icon size and icon positions remembered for one folder.
- **Operation** — a recorded change (move, rename, delete, duplicate, new folder) that can be undone;
  references the items it affected and where they were.
- **Index entry** — what the search index knows about one file item: its identity, its searchable
  text, and when it was last observed.
- **Volume** — a drive or mounted share, identified so that file identity and tags remain stable.

## Success criteria

- **SC-001**: A user who knows Finder can complete the four core journeys — navigate, preview,
  search, tag — with no instruction, in their first session.
- **SC-002**: A folder of 100,000 entries opens to a usable first screen in under one second on the
  target machine, and scrolling stays smooth.
- **SC-003**: A search over an index of one million files returns results in under 200 milliseconds
  once warm.
- **SC-004**: The first full index scan of roughly one million files completes within about one hour
  on the target machine.
- **SC-005**: Zero silent data-loss events: every destructive operation is recoverable by undo or
  from the Recycle Bin, and no operation overwrites without asking.
- **SC-006**: The app is installed from a single downloaded file and launched without reading any
  documentation.
- **SC-007**: No Windows Explorer setting, association or default handler is changed by installing or
  running the app — verifiable by comparing those settings before and after.

## Assumptions

- The primary target machine is a Windows on ARM64 device (Snapdragon X); x64 is a secondary build
  from the same source.
- The app is for one person initially; no multi-user, no accounts, no sharing features.
- The app is distributed unsigned; the SmartScreen warning on first install is accepted.
- A native code component is acceptable where it is the only way to reach the performance budget.
- Windows 11 (24H2 or later) is the floor.
- The filesystem is NTFS for the primary use; exFAT and network shares must work but with reduced
  guarantees (no extended attributes, unreliable change notification).
- OneDrive and other cloud-placeholder providers may be present; their files must not be hydrated
  implicitly.
- Content extraction runs locally; no file content leaves the machine.
- The design reference is macOS Finder as it exists today; a macOS build of this app is not in scope.

## Domain & outside experts

The domain is **desktop file management for people whose habits were formed on macOS Finder** — the
user is a working professional who moved from a Mac to a Windows on ARM machine and whose file
handling instincts are Finder's.

| Question | Answer |
|---|---|
| The industry/domain this is built for | Desktop file management / macOS-Finder power users on Windows |
| Expert role consulted (repeat per expert) | **macOS Finder behavior** (SME panel report, 2026-10-05) and **Windows platform feasibility** (SME panel report, 2026-10-05); both reports are retained in the project record |
| What that expert said, in their terms | Finder is not one product but a navigation model plus a metadata layer plus a preview layer plus a keyboard grammar. Column view, spacebar Quick Look with arrow-key walking, tags, the sidebar-as-drop-target, per-folder view state and real search are what carry the "Finder feel"; chrome, icon set and animation are cosmetic. On the Windows side: there is no supported API to become the default file manager, no cross-application metadata store, no Spotlight-class index, and no system-wide Quick Look — each must be replaced with something the app owns. |
| Effect on a requirement or story | This report is the origin of US-1 … US-8 and FR-001 … FR-038. Specifically: FR-005 (column view), FR-008/FR-009 (Quick Look with arrow-key walking), FR-014 … FR-017 (owned tag store, with the app-local limitation stated in the UI), FR-006 (per-folder view state), FR-028 … FR-031 (an owned index, because Windows Search cannot meet the budget), FR-035 (no shell takeover, because the SME established it cannot be done cleanly) and FR-027 (placeholder hydration, a trap the Windows SME named). |

**No domain practitioner outside software was consulted.** The owner is himself the domain
practitioner — a daily Finder user who has moved to Windows — and his decisions are recorded in
`docs/agents/decisions/0001-open-decisions.md`. No fabricated interview is recorded here. If a second
Finder-heavy user is available later, their input belongs in this table.

## User interviews (simulated, 4 personas)

**SIMULATED ROLE-PLAYS — not real interviews.** The four personas below are representative of the
kinds of file work the app must survive; each interview was simulated by a planning harness to surface
requirements and failure modes a software-only view misses. No real person said these words.

| # | Persona (their role, in the domain's terms) | What they were asked | What they said (SIMULATED) | Design / UX / functional decision it changed |
|---|---|---|---|---|
| 1 | **Photographer** — tens of thousands of RAW and JPEG files across several external drives, organized by shoot date | "How do you find a frame you shot months ago?" | "I remember the day and the place, not the filename. I sort by date, I want to see the picture, and I never want anything to download or re-index in the background while I'm culling." | FR-009 (arrow-key walking through previews, so culling is one keystroke per frame); FR-008 (images preview at full quality); FR-027 (external-drive and cloud files must not hydrate); US-6 (moving between drives must ask before copying). |
| 2 | **Software developer** — repositories with `node_modules` trees hundreds of thousands of files deep | "What is the worst thing a file manager does to you?" | "It chokes. And the file I actually want is never the one that's slow to find. Don't index my build output, and don't let a giant folder freeze the window." | FR-025 (100,000-entry responsiveness, SC-002); FR-031 (exclude folders from the index — the direct ask); FR-026 (live update without a manual refresh). |
| 3 | **Video editor** — multi-terabyte media on a RAID array and a network share, project files mixed with raw footage | "Where does a file manager cost you time?" | "Every second of scrub time. I need to see what a clip is before opening it, and I need my network drive to not hang the whole window when it drops." | FR-009 and FR-008 (video preview on spacebar); FR-032 (a dropped share shows as unavailable, the window stays usable); FR-021 (progress and cancel on multi-gigabyte copies); FR-022 (collision prompts on large moves). |
| 4 | **Office knowledge worker** — documents, spreadsheets and downloads, moved and renamed constantly, shared by email | "What do you do all day in your files?" | "Drag things around, rename them so I can find them later, and hunt for the attachment someone sent me last month. I use tags in Mail and I want them here." | US-4 and FR-014 … FR-017 (tags, including the plain statement that they are app-local); FR-013 (saved searches for recurring hunts); FR-023 (rename and re-tag from one panel); FR-024 (Windows shortcuts — this persona is the reason the owner's choice of F2 and Delete over a Finder map is the right one for the target machine). |

## Open questions

- [x] All resolved. Every decision that would otherwise be a marker is recorded in
  `docs/agents/decisions/0001-open-decisions.md` (D-0001 … D-0010), including the index scope, the
  content-extraction set and the performance budget forced by D-0003.
