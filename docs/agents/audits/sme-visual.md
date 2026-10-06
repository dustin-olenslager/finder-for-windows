# Finder for Windows — Visual Design Audit (SME report)

Repo: `/opt/data/repos/finder-for-windows` @ `e91f344`, v0.13.0. READ-ONLY audit; nothing edited.
Method: real renderer inlined by `scripts/build-preview.py` → Playwright screenshots (device_scale_factor=2)
+ `page.evaluate` computed-style/geometry probes, at 100/125/150% zoom, light **and** dark.
Artifacts: `/opt/data/cache/scratch/light-*.png`, `dark-*.png`, `ff-measure.json`, `ff-probe2.json`,
`zoom*-probe.json`. Contrast ratios computed with the WCAG relative-luminance formula from the
composited colors (alpha over the actual backdrop).

**The one-line answer to "does it look like software Apple shipped?"** No — it looks like a *good
Windows app wearing macOS grammar*. The structure (Miller columns, a segmented view control, a
translucent sidebar, a preview inspector) is Finder-correct. What is not Apple is the **finish**:
one type family that is not the system font for this OS, a gray-muted text ramp that misses AA in
light mode, a toolbar title that drifts 352px off-centre at 150% zoom, six ad-hoc corner radii
against a 7px token, four icon sizes and seven stroke widths, and effectively zero motion.

---

## 1. FINDINGS

Severity tags: **[BLOCKER]** visible to any user in the default view · **[MAJOR]** visible in a
named state (list, icon, zoom, light) · **[MINOR]** polish · **[SILENT]** invisible until measured.

### 1.1 Design tokens — coherent in shape, broken in practice

- **[MAJOR] Five variables are referenced but never defined; the fallback is what renders.**
  `--bg-soft`, `--accent-soft`, `--hover`, `--line-soft`, `--fg-dim` appear in **10 declarations**
  and are defined nowhere. Measured: all six probed vars report `<<UNDEFINED>>` from
  `getComputedStyle(document.documentElement)`.
  - What it looks like: two controls are tinted with colors from a *different* palette than the
    rest of the app, and one sidebar label silently borrows body text color.
  - `--accent-soft` (`style.css:1085,1142,1152,1204`) falls back to `rgba(64,128,255,0.14)` →
    measured `rgb(228,237,255)` on white. The real accent is `#0a68d8 = rgb(10,104,216)`. So the
    sort/filter "on" chip and the clipboard pastebar are tinted with a **different blue** from the
    app's own accent.
  - `--bg-soft` (`style.css:210,1101`) falls back to neutral `rgba(127,127,127,…)`. Measured
    `.preview-steps` background `rgba(127,127,127,0.08)` — a **neutral gray** control sitting inside
    a blue-accented toolbar.
  - `--hover` (`style.css:1203`) falls back to **white 6%**. In light mode the sidebar is near-white,
    so `rgba(255,255,255,0.06)` over `rgb(247,247,249)` = contrast **1.00:1**: the tag-row hover is
    literally invisible in light mode.
  - `--fg-dim` (`style.css:1164,1171,1179,1190`) is undefined, so `color: var(--fg-dim)` is invalid
    and **falls back to inherited `--fg`**: the "Kept by this app only" note, the "Right-click a
    file…" empty text and the tag count all render at full body color `rgb(29,29,31)` instead of a
    dim tier. The three tier colors the design intends collapse into one.
  - Verdict: **I trusted the measurement.** Vision read the sidebar note as "italic, small, gray —
    hard to read"; computed color is `rgb(29,29,31)` = 15.7:1. The measurement wins: it is not dim,
    it is mislabeled.

- **[MINOR] The radius token is decorative, not a scale.** `--radius: 7px` is used at only **3**
  sites (`style.css:246,285,800`). Six radii ship: measured `4px, 5px, 6px, 7px, 8px, 12px`.

- **[MAJOR] There is no spacing scale.** 9 distinct gap values in use — measured `1,2,3,5,6,7,8,10,12px`
  — plus paddings `0 8px / 0 10px / 0 12px 0 14px / 3px 6px / 3px 10px / 5px 12px / 6px 12px /
  10px 8px 14px / 10px 12px`. Every value is a one-off decision. Only `--row-h: 26px` is a real
  rhythm token, and it is used consistently (sidebar-item, row, quicklook-line, list row).

- **[SILENT] 309 hard `px` values, 0 `rem`.** Confirms the earlier audit. This is *why* interface
  scaling is `setZoomFactor` and not a font-size change: there is no relative unit for a root
  font-size to act on. It is also why the toolbar breaks at zoom (see 1.5).

- **[MINOR] No elevation scale.** Exactly **2** distinct box-shadows in the whole sheet: the
  segmented-control inset ring (`0 1px 2px rgba(0,0,0,.18), inset 0 0 0 1px`) and the Quick Look
  card (`0 24px 70px rgba(0,0,0,.4)`). Menu panel, modal, and toast each carry their own hand-rolled
  shadow at three different spreads. Nothing shares a level.

### 1.2 Typography

- **[BLOCKER] The typeface is not the system font for the target OS, and it is not macOS SF either.**
  `--font` (`style.css:27`) = `-apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui,
  sans-serif`. On Windows (the shipping target) this resolves to **Segoe UI Variable Text**. The
  file's own header comment claims "the system palette so the app sits correctly in Windows light
  and dark mode", but the app is called *Finder* and imitates macOS — and it renders in Segoe, not
  SF. Measured `body` font-family is the raw stack; there is no `@font-face`, so on any machine
  without Segoe UI Variable it degrades to `system-ui` (Arial-class), which changes all metrics.
  - Vision independently called it "generic Windows line icons… Fluent UI style" and "not macOS
    Finder icons". The measurement agrees with the eye here.

- **[MAJOR] The type scale has 7 steps, three of them odd.** Measured font sizes in the live DOM:
  `10, 11, 11.5, 12, 13, 13.3333, 16` px.
  - `13.3333px` is the **unstyled default** — it is every `<button>` and `<svg>` that never
    received `font: inherit`. Affected: `#back`, `#forward`, `#up`, all three `.seg`, `.zoomOut`,
    `.zoomIn`, `.step-btn`, `.search-clear`, `.list-sort` (measured `13.3333px / Arial`). Their
    glyphs are sized by CSS so nothing is visibly broken, but **icon buttons are the one class of
    control whose text metric is the UA default**, which is exactly where a future `em`-based icon
    size would silently drift.
  - `11.5px` (`zoom-value`, `info-block`, `shortcut-list dt`) and `16px` (the Quick Look /
    modal title, since `.modal-title` is `13px` but `h*` inside `.preview-body` inherits UA 16px)
    are the two odd ones. A clean scale would be 10/11/12/13/15.
  - No type-scale token exists. Every size is a literal.

- **[MAJOR] `line-height` is `normal` for the entire application.** Measured: the only computed
  `line-height` across the DOM is `normal`. Exactly two rules set one (`style.css:771` `.icon-label
  1.25`, `style.css:889` `.preview-text 1.5`). Consequence: row text in a 26px row relies on the
  font's default leading, and the icon-view label measured **13.75px** line-height on an 11px font
  — tighter than the 1.25 the rule intends, because the clamp box overrides it. Labels with
  descenders (g, y, p — and every `_VO` filename) sit tight against the clamp edge.

- **[MINOR] Only two font weights ship: 400 and 600.** Measured `[400, 600]`. No 500 for
  intermediate emphasis, no 700. Titles, breadcrumb current, list headers, sidebar headings and the
  preview name all land on 600, so "emphasis" has one volume.

### 1.3 Colour system, and does light mode exist?

- **Light mode exists and works.** Both themes render; `@media (prefers-color-scheme: dark)`
  (`style.css:30-45`) redefines 11 of the 16 light vars. **Vision's read that "the app is light
  themed" and the dark render "is dark mode with good contrast" both match the measurements.** The
  earlier suspicion that only dark mode worked is **false** — verified by rendering both.
  *(Caveat on method: the harness pins `color-scheme` on the Playwright context. The app itself
  declares `color-scheme: light dark` at `style.css:10` and carries no manual theme switch, so the
  app follows Windows. That is a correct default, not a defect.)*

- **[BLOCKER] The muted text ramp fails WCAG AA in light mode.** `--fg-muted` is `#7a7a7f`; light
  surfaces are `#ffffff`, toolbar `rgb(251,251,252)`, sidebar `rgb(247,247,249)`. Composited ratios:

  | pair | ratio | verdict |
  |---|---|---|
  | `--fg-muted` on `--bg` (white) | **4.27:1** | fails AA (needs 4.5) |
  | `--fg-muted` on sidebar | **3.99:1** | fails |
  | `--fg-muted` on toolbar | **4.13:1** | fails |
  | `--fg-muted` on indexbar tint | **3.66:1** | fails |
  | `--fg-muted` @0.45 (disabled) on white | **1.76:1** | fails badly |
  | `--fg-muted` @0.55 (disabled menu) on bg | **2.02:1** | fails badly |
  | `--fg-muted` @0.6 (breadcrumb separator) on toolbar | **2.14:1** | fails badly |
  | dark `--fg-muted` #98989d on #1c1c1e | 5.93:1 | **passes** |

  This is the single largest *visible* finish gap. **Every secondary label in light mode is under
  the line**: column headers (Kind/Size/Date), breadcrumb parents, preview metadata, status bar,
  sidebar section headings, the zoom readout, the info-block keys. The dark theme's muted value is
  *lighter* (`#98989d` vs `#7a7a7f`) and passes — so the light ramp was simply not tuned. Vision
  flagged "gray… only moderate contrast" in dark and "hard to read" for the italic note; the
  measurement says dark is fine and **light** is the failure.

- **[MAJOR] Disabled states are near-invisible by construction.** `.icon-btn:disabled` is
  `color: var(--fg-muted); opacity: 0.45` (`style.css:172`) → **1.76:1**. In the default view Back
  and Forward are both disabled (measured `rgb(122,122,127)` @ 0.45 on white). Vision read them as
  "grayed out/disabled" — correct — but the value is below any usable threshold; a disabled control
  that is invisible reads as *missing*, not *unavailable*.

- **[MINOR] Selection is one blue in both themes.** `--bg-selected: #0a68d8` is identical in light
  and dark (measured), while `--accent` changes from `#0a68d8` to `#4c9aff`. So in dark mode the
  selection fill is a *darker, less saturated* blue than the accent used for glyphs and the "on"
  chip — the two blues fight. White-on-`#0a68d8` = **5.27:1** in both, which passes, so the fill
  itself is fine; the inconsistency is that selection does not track the theme's accent.

- **[MINOR] Dark accent is used as text at 5.97:1, light accent at 5.27:1** — both pass, but the
  light `--accent` as *text on the soft chip* is **4.48:1**, i.e. the sort/filter "on" label fails
  AA by 0.02 while the same control passes in dark. Marginal, but it is a fail.

- **[MINOR] The `--line` ramp is used for three unrelated jobs.** Measured: `rgba(0,0,0,0.1)` light
  / `rgba(255,255,255,0.12)` dark is simultaneously (a) the 1px structural borders, (b) the
  `.icon-btn:active` background (`style.css:171` — `background: var(--line)`), and (c) the
  scrollbar thumb (`style.css:1054`). As a scrollbar thumb in light mode that is `#e6e6e6` on white
  — the thumb is **nearly invisible until hovered** (hover swaps to `--fg-muted`, `style.css:1059`).

### 1.4 Iconography — the weakest area

- **[MAJOR] Four icon sizes and seven stroke widths, with no optical-size correction.**
  Measured sizes in use: **13, 14, 15, 16px** (search glyph 13, tool-btn 14, icon-btn/seg 15,
  glyph 16). Measured stroke widths in the source: **1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8**
  (`app.js:129-159`, `index.html:25-156`). A 1.8px stroke at 15px (preview prev/next,
  `index.html:148,152`) is heavier than the 1.7px nav arrows and heavier still than the 1.2px file
  glyphs at the same optical weight class. Apple ships one stroke weight per size and scales it;
  here the weight is chosen per-icon by hand.
  - Vision: "consistent stroke width"; "crisp… quality is high". Measurement disagrees — 7 widths
    is not consistent. **I trust the measurement**: the eye cannot resolve 1.2 vs 1.4 at 15px, but
    the source is unambiguous.

- **[MAJOR] Fill and stroke semantics are mixed inside one set.** Folder/drive/archive glyphs are
  **filled** (`fill="currentColor"`, e.g. `app.js:129` folder at `opacity .92`); file/document/
  video/image glyphs are **stroked outlines** (`fill="none" stroke="currentColor"`). In a 26px row
  a filled blue folder and a hairline blue outline sit side by side. macOS ships full-colour,
  optically-matched file-type icons; Windows ships filled Fluent glyphs. This is neither.

- **[MINOR] The icon set is monochrome-only, so every file kind looks the same.** Every glyph paints
  `currentColor` — sidebar glyphs `--accent`, list glyphs `--accent`, preview glyphs `--accent`.
  Vision twice reported "colourful file icons (green Excel, red PDF)" — that is a **vision
  hallucination**; measured, all 35 SVGs take their colour from `currentColor`, and the distinct
  fills are only `rgb(0,0,0)` (unstyled, see below) and the inherited text colour. **Measurement
  wins.** Consequence for the user: a `.pdf`, a `.png` and a `.xlsx` are the same blue at a glance —
  the app has `KIND_SVG` per kind but renders them all in one colour, throwing away the only
  differentiator at 16px.

- **[SILENT] Every SVG reports `fill: rgb(0,0,0)` from the UA.** 35/35 SVGs measured `fill: black`
  before `currentColor` applies per-element. Harmless today (the `<path>`s set their own `fill`),
  but it means any future icon that *forgets* `fill` renders solid black rather than inheriting.

- **[MINOR] Three real file kinds have no icon and fall back to the generic document.**
  `src/domain/file-kind.js` emits **14** kinds (image, video, audio, pdf, document, spreadsheet,
  presentation, archive, code, text, **font, disk, shortcut**, other). `KIND_SVG` (`app.js:140-160`)
  defines 11. `font`, `disk` and `shortcut` are absent → `iconFor()` (`app.js:162-165`) returns
  `SVG.file`. So a `.ttf`, a `.vmdk` and a `.lnk` are all drawn as a blank page. (Note: the
  `SVG.network / removable / drive / home` entries *are* reachable — `get-sidebar.js:48` emits them —
  so there are no dead icons; there are *missing* ones.)

- **[MINOR] The list view spends a 16px grid column on an icon it does not need.** List grid is
  `16px 1fr 130px 84px 150px` (`style.css:703`) — column 1 is the glyph, column 2 the name. It is
  correct that the glyph leads the name; the defect is that the **Name header is placed in column 1
  while filenames sit in column 2**, so the header "Name" is **24px left of every filename it
  labels** (measured: header x=202, row name x=226). Kind/Size/Date headers align *exactly*
  (498/636/728 both) — the Name header is the one that does not.

### 1.5 Density and breathing room

- **[MAJOR] 134px of chrome before the first file, on a 760px window.** Measured stack:
  menubar 26 + toolbar 52 + indexbar 30 + breadcrumb 26 = **134px**, i.e. **17.6%** of the window
  height is spent before content, plus statusbar 24 at the bottom. The sidebar begins at `y=134`.
- **[MAJOR] 480px of the 1180px width (40.7%) is sidebar (190px) + preview pane (290px).** Both
  carry `backdrop-filter: blur(20px)` and a translucent background; they are the most expensive
  surfaces in the app and the preview pane is on by default (`body.has-preview`, `index.html:85`
  `is-on`).
- **[MINOR] The column view is 250px fixed and overflows on the first screen.** Column 1 of
  `C:\Users\dustin` holds 11 rows × 26px = 286px + 8px padding, inside a **602px** column — that
  fits. But the *fixture's* real production folder `03_Approved` holds 9 rows and the owner's real
  folder holds more; there is no auto-size and no resize handle. Vision flagged "no visible resize
  handles" — correct, and `column` has no `resize` affordance in CSS or JS.
- **[MINOR] Density is uniform: one row height (26px) for every list in the app** — sidebar,
  columns, list view, Quick Look lines. Good for rhythm, but it means the Quick Look overlay's
  folder listing has the same 26px rhythm as a sidebar of five favourites, which reads as cramped
  inside an 860px card.

### 1.6 Alignment and the grid

- **[BLOCKER] The toolbar title is not centred, and the error grows with zoom.** The comment at
  `style.css:136-138` claims equal `flex:1` sides make the title optically centred. They do not,
  because **the left group is content-sized (3 nav buttons ≈ 502px of flex basis) while the right
  group holds 11 controls (583px)** — measured `flex: 1 1 0%` on both, but `min-width: auto` lets
  each side grow to its content. Measured title centre vs window centre:
  - 100%: title centre **550.5**, window centre **590** → **−39.5px off**
  - 125%: **394.1** vs 590 → **−195.9px off**
  - 150%: **237.7** vs 590 → **−352.3px off**

  At 150% the title "Videos" sits a third of the way across the window. Vision read the 150% shot
  as "pushed to the left"; the measurement quantifies it. **This is the defect most likely to be
  the one the owner names.**
- **[MINOR] List numeric columns are left-aligned.** `.col-size/.col-date/.col-kind` measured
  `text-align: start`. Sizes (`12 MB`, `12 KB`, `13 MB`) do not line up on their magnitude, and
  dates do not line up on their time. `font-variant-numeric: tabular-nums` is correctly applied, but
  tabular figures only help if the column is right-aligned or the values share a width.
- **[MINOR] `list-header` is 24px tall, rows are 26px.** A 2px mismatch between the header cell and
  the column it heads (`style.css:714` vs `723`).
- **[MINOR] The empty state is not centred.** `.hint { margin: 14px 16px }` (`style.css:792-796`)
  puts "This folder is empty." / "Loading…" in the top-left corner of the content area. Vision read
  it as "not vertically centred, which may look unbalanced". It is the app's only full-pane state
  and it is a corner caption.
- **[MINOR] The tag rows do not share the sidebar's alignment.** `.sidebar-item` is
  `height: var(--row-h); padding: 0 8px; border-radius: 6px`. `.tag-item` (`style.css:1175,1202`)
  is `display:flex; gap:8px; padding-right:10px` — **no height, no left padding, no radius**. Tag
  rows will sit flush to the sidebar edge while Favorites/Locations are inset 8px, breaking the one
  vertical rhythm the app gets right.

### 1.7 The chrome compositions, one by one

- **Toolbar [MAJOR]:** 52px, 14 interactive targets. Measured left-to-right: back(28×26),
  forward(28×26), up(28×26) | title | sort(86×26), filter, segmented(3×30×24), search(input 150px),
  preview-toggle(28×26), zoom(22/42/22). It is **overloaded**: Sort and Filter are *dropdowns that
  look like toolbar buttons*; the preview toggle is a *mode* rendered identically to a *command*;
  zoom is a third grouping with its own container. Three different control grammars — button,
  segmented, stepper — sit in one 52px strip with only a 6px gap between groups.
- **Menu bar [MAJOR — deletion candidate]:** 26px, File/View/Go/Help. This is a *Windows menu bar
  inside the window* above a toolbar that already exposes View, sort and filter. Finder has no
  in-window menu bar. It is 26px of chrome duplicating the toolbar.
- **Breadcrumb [MINOR]:** 26px, 11px text, `›` separators (`app.js:854`, so **not** a `>` glyph —
  vision's "> instead of ›" is a low-res misread; measurement wins). It is a second navigation
  affordance directly under a 26px index bar and a 52px toolbar, and its parents render at
  `--fg-muted` = 4.13:1 (fails AA).
- **Status bar [MINOR]:** 24px, 11px text, `--fg-muted` = 4.13:1 (fails AA). Left "11 items ·
  6 folders · selected: 47 KB", right the full path with `direction: rtl` (`style.css:1045`) so the
  *end* of a long path stays visible — a genuinely good, Finder-correct trick.
- **Sidebar [MINOR]:** 190px, `backdrop-filter: blur(20px)`, sections Favorites/Locations/Tags.
  The **Tags section is empty in the fixture** and renders two lines of italic explanation
  (`--fg-dim` → body color, 15.7:1 — the "dim" tier does not exist). An empty section that
  explains itself is noise; it should collapse.
- **Preview pane [MAJOR]:** 290px, on by default. Two composition defects:
  1. **It duplicates the column the user is already looking at.** `renderPreview()`
     (`app.js:890-919`) renders `quicklook-list` of the selected folder's **children** — the same
     list the column view is showing one pane to the left. Vision caught this twice ("redundant
     right sidebar: it duplicates the file list"; "the list of items in the preview pane is sorted
     differently"). Confirmed in source.
  2. **`Where` duplicates `Path`.** `buildInfoBlock` emits both (`app.js:921`); vision saw
     `Where: C:\Users\dustin` next to `Path: C:\Users\dustin\Videos` in every preview. One row is
     the other minus its last segment.

### 1.8 States, for every interactive element

| element | hover | focus | selected/active | disabled |
|---|---|---|---|---|
| `.icon-btn` | yes (`--bg-hover`) | **yes** (`:focus-visible`) | `.is-on` blue | yes but 1.76:1 |
| `.seg` | yes | **yes** | `.is-active` ring | none defined |
| `.sidebar-item` | yes | **yes** | `.is-active` blue | none defined |
| `.icon-cell` | yes | **yes** | `.is-selected` tint+ring | none defined |
| `.crumb` | yes | **NO** | `:last-child` 600 | n/a |
| `.row` | yes | **NO** | `.is-selected` | n/a |
| `.menubar-item` | yes | **NO** | `.is-open` | n/a |
| `.tool-btn` | yes | **NO** | `.is-on` (fails AA text) | n/a |
| `.text-btn` | yes | **NO** | none | n/a |
| `.btn-primary/.btn-secondary` | yes | **NO** | none | none defined |
| `.search-clear` | colour only | **NO** | n/a | n/a |
| `.list-sort` | underline | **NO** | `aria-sort` colour | n/a |
| `.tag-item` | **invisible in light** | **NO** | `.is-active` | n/a |
| `.menu-entry` | yes | yes | `.is-checked` ✓ | yes but 2.02:1 |

- **[BLOCKER] Keyboard focus is invisible on 9 of the interactive classes.** `:focus-visible` is
  defined for only **4** selectors (`style.css:234-240`). `.row`, `.crumb`, `.menubar-item`,
  `.tool-btn`, `.text-btn`, `.btn-primary`, `.btn-secondary`, `.search-clear`, `.list-sort` have
  **no focus style at all** — and `.menu-entry:focus-visible` sets `outline: none`
  (`style.css:394`) with only a hover-colour background as the substitute. The app is fully
  keyboard-driven (F2, Ctrl+C, Enter, arrows — the whole shortcut surface exists) yet you cannot
  see where you are in the list.
- **[MAJOR] No pressed/active state on most controls.** `:active` exists only on `.icon-btn`
  (`--line` bg) and the two copyable text affordances. `.seg`, `.tool-btn`, `.text-btn`,
  `.btn-primary`, `.crumb`, `.row` have no `:active`, so clicking the view switcher or a menu
  gives no tactile confirmation.
- **[MAJOR] No disabled treatment for the controls that actually disable.** `.seg`, `.tool-btn`,
  `.text-btn`, `.btn-*` define no `:disabled`. Only `.icon-btn` and `.menu-entry` do, and both
  land under 2.1:1.

### 1.9 Borders, radii, shadows, elevation

- **[MAJOR] The app is drawn with rules, not with space.** Full-width 1px `--line` borders stack
  on **five** chrome bands (menubar, toolbar, indexbar, breadcrumb, statusbar) plus sidebar-right,
  preview-left and every column-right. At 1180×760 the top-left quadrant shows **four parallel
  horizontal hairlines within 134px** and **two vertical hairlines** flanking the content. Finder
  separates panes with *space and translucency*, not a rule per band.
- **[MINOR] All borders share one weight and colour.** Every border in the sheet is
  `1px solid var(--line)`. There is no strong/soft distinction, no focus ring variant (the focus
  ring is `2px solid var(--accent)`, `style.css:238`). Measured distinct border colours:
  `rgba(0,0,0,0.1)`, plus inherited `rgb(29,29,31)`/`rgb(122,122,127)` where a border inherits
  `currentColor` (visible in the probe as `border-top-color: rgb(29,29,31)` on some elements) —
  i.e. a few borders are accidentally the *text* colour, not `--line`.
- **[MINOR] Two shadows total** (see 1.1). Menu panel `0 14px 40px`, modal `0 18px 50px`, toast
  `0 10px 30px`, Quick Look `0 24px 70px` — four elevations, none shared, no scale.

### 1.10 Motion

- **[BLOCKER — for a stated pillar] There is effectively no motion.** Measured: **one** transition
  in the entire stylesheet — `style.css:1020` `transition: opacity 0.4s ease` on the toast. Zero
  `@keyframes`, zero animated hover, zero list-row enter/leave, zero column-slide.
  `AGENTS.md` names "low motion intensity except spring-loaded folders" as a pillar; spring-loaded
  folders have **no CSS animation at all**, so the one moment that should move does not.
- **[MAJOR] No `prefers-reduced-motion` handling.** `grep` returns **0** occurrences in
  `style.css`. The one animation that exists (toast fade) does not honour it. For an app whose
  pillar is motion, this is the compliance gap.
- **[MINOR] Hover changes are instantaneous.** Because there is no transition, every hover snaps.
  That is *defensible* for a dense file list (Finder snaps too), but it is a choice the sheet never
  states, and it makes the one deliberate transition (the toast) read as the odd one out.

### 1.11 At 125% and 150% zoom

Measured at 125% and 150% (`zoom1.25-probe.json`, `zoom1.5-probe.json`):

- No element overflows the window (`overflowRight: []`), and no label clips
  (`clipped: []`) at either zoom — the layout **holds**.
- The toolbar title drifts **−196px / −352px** (see 1.6). This is the only zoom-level break.
- The search input stays **150px** fixed while everything around it scales, so it becomes
  proportionally *smaller* relative to the toolbar — at 150% the search box is the same 150 CSS px
  in a 1.5× toolbar.
- Because every dimension is `px`, `setZoomFactor` scales *everything uniformly*, including the
  1px hairlines and the 15px icons. There is no way to scale text without scaling the whole UI,
  which is the direct consequence of the 309px / 0rem measurement in 1.1.

### 1.12 Where vision and measurement disagreed (and who won)

| vision said | measurement said | trusted |
|---|---|---|
| "colourful file icons (green Excel, red PDF)" | all 35 SVGs are `currentColor`; no per-kind colour | **measurement** |
| "the app is light themed" (single shot) | light **and** dark both render correctly | **both** (mode was per-shot) |
| "icons have consistent stroke width" | 7 distinct stroke widths, 4 sizes | **measurement** |
| breadcrumb uses "`>` instead of `›`" | source is `›` (`app.js:854`) | **measurement** |
| "the Tags italic note is hard to read / dim" | renders at `rgb(29,29,31)` = 15.7:1, i.e. **not** dim | **measurement** |
| "the title is pushed left" | off-centre −39.5px @100%, −352px @150% | **both agree** |
| "redundant inspector duplicating the file list" | confirmed in `app.js:890-919` | **both agree** |
| "no column resize handles" | confirmed — no resize in CSS or JS | **both agree** |
| dark "secondary text… moderate contrast" | dark muted = 5.93:1, **passes**; light = 4.27:1, fails | **measurement** |

---

## 2. RANKED PLAN

Ranked by how much each improves the look per unit of risk. Size: S ≤ half a day, M ≈ 1 day,
L > 1 day. Every fix is CSS-only unless noted.

| # | Fix (one line) | Impact | Size |
|---|---|---|---|
| 1 | **Fix the toolbar title centring** — replace the two `flex:1` groups with a 3-column grid (`1fr auto 1fr`) or absolute-centre the title; kills the −39.5/−196/−352px drift (`style.css:131-154`). | Largest visible geometry defect, worst at zoom | **S** |
| 2 | **Re-tune the light muted ramp** — darken `--fg-muted` to ≈`#5f5f66` (≈5.6:1 on white) and add a real dim tier; every secondary label in light mode stops failing AA (`style.css:19`). | Affects every screen in light mode | **S** |
| 3 | **Define the five ghost tokens** (`--accent-soft`, `--bg-soft`, `--hover`, `--line-soft`, `--fg-dim`) in `:root` and dark, derived from `--accent`/`--fg`; the sort chip, pastebar, preview stepper and tag rows stop using a foreign palette (`style.css:9-45`). | Removes 10 silent fallbacks | **S** |
| 4 | **Add `:focus-visible` for the 9 unstyled classes** (`.row`, `.crumb`, `.menubar-item`, `.tool-btn`, `.text-btn`, `.btn-primary/.btn-secondary`, `.search-clear`, `.list-sort`) and give `.menu-entry:focus-visible` its outline back. | The app is keyboard-first; currently unfocusable-looking | **S** |
| 5 | **Raise disabled legibility** — replace `opacity: .45` with a real disabled colour at ≥3:1 (`style.css:172`, `387-391`). | Two controls are invisible today | **S** |
| 6 | **Unify the icon set** — pick one stroke width per size (1.5 at 13-15px, 1.25 at 16px), one size scale (14/16), and one fill rule; add `font`/`disk`/`shortcut` glyphs (`app.js:127-160`). | Biggest craft gap; makes the set look drawn by one hand | **M** |
| 7 | **Introduce a spacing + radius + type scale as tokens** — collapse 9 gaps → 4/8/12, 6 radii → 4/6/8, 7 sizes → 10/11/12/13/15, then delete the ad-hoc values. | Turns a pile of literals into a system | **M** |
| 8 | **Fix the Name column header offset** — move the "Name" header into grid column 2 or span 1-2 (`style.css:703,715`). | One-line alignment fix on the most-read view | **S** |
| 9 | **Right-align Size/Date (or give them a shared width)** — `text-align: end` on `.col-size`/`.col-date`; tabular-nums already set. | Scannability of the list view | **S** |
| 10 | **Centre the empty state** — `.hint` becomes a centred flex state, not a 14px margin caption (`style.css:792`). | The only full-pane state, currently a corner label | **S** |
| 11 | **Cut the chrome stack** — delete the in-window menu bar (see §3) and fold breadcrumb into the toolbar; reclaims 26-52px and removes 2 of the 5 hairlines. | Biggest breathing-room win | **M** |
| 12 | **Stop the preview pane echoing the list** — for a folder, show metadata + a count only, not the child list (`app.js:890-919`). | Removes the clearest "unfinished" tell | **S** |
| 13 | **Add a motion layer** — one shared `--dur`/`--ease`, a 120ms hover transition, a spring-loaded folder open, and a `@media (prefers-reduced-motion: reduce)` block that zeroes it. | The stated pillar, currently absent | **M** |
| 14 | **Scale the search input with the toolbar** — replace `width: 150px` with a flex-basis that grows, so it does not shrink proportionally at 150% (`style.css:293`). | Zoom-level polish | **S** |
| 15 | **Move the system font stack to a `@font-face`-free, OS-honest stack** — lead with `system-ui` and drop `-apple-system`, or ship a variable font; decide whether this app looks like macOS or Windows and make the type say so (`style.css:27`). | Strategic, not cosmetic | **M** |

**Suggested order of landing:** 1 → 2 → 3 → 4 → 5 (a "correctness" PR, all S), then 6 → 7 (the
"system" PR), then 8-12 (the "composition" PR), then 13 (the "motion" PR).

---

## 3. DELETION CANDIDATES

The step that gets skipped, so here it is as an artifact. For each: **removed / deferred / kept**,
with the reason.

1. **The in-window menu bar (`index.html:15-20`, `style.css:306-331`) — REMOVE.** 26px, four
   buttons, on every screen, duplicating View/sort/filter already in the toolbar and the full
   action set already in the right-click context menu. Finder has no in-window menu bar; this one
   exists to make features "findable without knowing a shortcut", which the toolbar and context
   menu already do. Deleting it removes 26px of chrome and one of the five stacked hairlines.
   *Alternative kept in mind:* if discoverability is the named requirement, keep **Help** only as a
   single toolbar "?" — but do not keep a four-item bar.
2. **The preview pane's folder child-listing (`app.js:890-919`, `.quicklook-list`) — REMOVE for
   folders.** It renders the same items as the column to its left, in a different order, at a
   narrower width. Keep the metadata block. This is the change most likely to make the pane stop
   looking unfinished.
3. **The `Where` row in the info block (`app.js:921`) — REMOVE.** It is `Path` minus its last
   segment; two rows say one thing. If the parent folder matters, make `Path` show the parent and
   the name separately.
4. **The persistent index-status sentence (`indexbar`, `index.html:112-117`) — REMOVE the idle
   state.** "Index covers 3 files · 2 with contents read · built in 1 min" narrates an internal
   process in 30px of always-on chrome; vision read it as "technical text… takes up vertical
   space". Keep the bar **only while indexing** (`indexbar.is-running` already exists) and drop the
   idle summary to a status-bar tooltip.
5. **The empty Tags section's two-line self-explanation (`style.css:1162-1173`) — REMOVE.** A
   section that contains only an explanation of why it is empty should not render at all.
6. **`--radius: 7px` (`style.css:25`) — REMOVE, or make it the only radius.** Used at 3 of 9
   rounded sites; six radii ship. Either delete the token and accept the hand-picked values, or
   keep it and delete the other five. Keeping both is the worst option.
7. **`--line` as the scrollbar thumb (`style.css:1054`) — REMOVE.** In light mode the thumb is
   `#e6e6e6` on white and invisible until hover. Give scrollbars their own token.
8. **The `16px` glyph grid column in list view (`style.css:703`) — KEEP but fix.** It is redundant
   with the name's own icon, but deleting it would lose the kind-at-a-glance affordance; the fix is
   header alignment (plan #8), not removal.
9. **The `13.3333px`/`Arial` UA default on icon buttons (`style.css:156-172`, `250-261`) — REMOVE
   by adding `font: inherit`.** Not a visible bug today; it is the vector for a future one.
10. **The idea "add a light/dark theme toggle" — DEFERRED, not built.** The app follows
    `prefers-color-scheme`, which is the correct Windows-native behaviour; a manual switch would be
    new chrome for no named requirement. Recorded here so it is not re-proposed.
11. **The idea "switch the whole typeface to SF Pro and ship the font" — DEFERRED.** Licensing and
    weight cost for a public MIT repo; plan #15 asks for an explicit decision, not an automatic
    font bundle.

---

## 4. WHAT IS ALREADY GOOD — do not churn this

Named so the final pass does not sand it off:

- **The column-view geometry.** 250px fixed columns, `border-right` separators, `border-right: 0`
  on the last, sticky headers in list view, 26px rows. It reads as Finder and it is stable at every
  zoom tested.
- **The selection pill.** `.row.is-selected` = `--bg-selected` with `border-radius: 5px` and a 4px
  horizontal inset (`style.css:660-676`). White on `#0a68d8` = **5.27:1** in **both** themes. Vision
  called the sidebar selection "a rounded blue pill… macOS Finder-like". It is correct — keep it.
- **Dark mode.** It is real, it is coherent, and its muted ramp **passes AA** (5.05-5.93:1). Do not
  "fix" dark when fixing light (finding 1.3).
- **`--row-h: 26px` as a single density token**, applied consistently to sidebar, columns, list and
  Quick Look. One rhythm, no drift.
- **The segmented view control.** `--bg-hover` track, 2px padding, active segment = `--bg` + an
  inset 1px ring + a 1px drop (`style.css:243-277`). This is the most Finder-faithful single
  component in the app.
- **`direction: rtl` on the status path** (`style.css:1045`) so a long path keeps its *end*
  visible. A genuinely Apple-grade detail.
- **Ellipsis discipline.** Every truncatable label has `overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap`, and **measured clipping at rest is zero** (`truncated: []`). Nothing
  overflows on load.
- **`font-variant-numeric: tabular-nums`** on sizes, dates, counts and the zoom readout — the
  right instinct, one right-align away from paying off.
- **`file-kind.js` as a single source of truth** for what a file is, shared by the icon, the
  preview route and the Kind column. That is the correct architecture and it is why the icon gap
  in 1.4 is a *missing-icon* problem and not a *disagreement* problem.
- **The right-click context menu panel** — grouping, separators, right-aligned accelerators,
  `✓` checkmarks (`style.css:369-374`). Vision's only complaints were about menu *width* and
  *native-ness*, not its craft.
- **The breadcrumb's `›` separator and clickable cumulative path** (`app.js:850-868`).
- **`scrollbar-width: none` on the breadcrumb** (`style.css:89`) — horizontal overflow that does
  not grow a scrollbar. Correct.
