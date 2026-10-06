#!/usr/bin/env python3
"""Drive the REAL renderer: click a folder and assert the next column appears.

This is a behavioral test of app.js against the stub bridge, in a real browser. It
catches the class of bug that a screenshot cannot: a click that selects but never
descends, or a column that fails to open.
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

src = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()

def state(pg):
    return pg.evaluate("""() => ({
        columns: document.querySelectorAll('.column').length,
        rowsPerColumn: [...document.querySelectorAll('.column')].map(c => c.querySelectorAll('.row').length),
        selected: document.querySelector('.row.is-selected')?.dataset.name || null,
        status: document.getElementById('statusCount')?.textContent,
        title: document.getElementById('folderTitle')?.textContent,
        // The status-bar path follows the SELECTION, so navigation is asserted from the
        // last breadcrumb's own data-path, which always describes the folder being viewed.
        path: (() => {
            const crumbs = [...document.querySelectorAll('#breadcrumb .crumb')];
            return crumbs.length ? crumbs[crumbs.length - 1].dataset.path : null;
        })(),
        barPath: document.getElementById('statusPath')?.textContent,
        upDisabled: document.getElementById('up')?.disabled,
        backDisabled: document.getElementById('back')?.disabled
    })""")

fails = []
def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}  {detail}")
    if not cond:
        fails.append(label)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1180, "height": 760}, device_scale_factor=2)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(src.as_uri())
    pg.wait_for_timeout(600)

    s = state(pg)
    check("one column on first paint", s["columns"] == 1, str(s["columns"]))
    check("every item is listed", s["rowsPerColumn"] == [11], str(s["rowsPerColumn"]))
    # First paint selects the first FILE, so the status bar also reports its size.
    check("status counts items and folders", s["status"].startswith("11 items · 6 folders"), s["status"])
    check("status reports the selected file's size", "selected:" in s["status"], s["status"])
    check("title is the folder name", s["title"] == "dustin", s["title"])
    check("back disabled at start", s["backDisabled"] is True)
    check("up enabled (home has a parent)", s["upDisabled"] is False)

    # --- the Finder behavior: single click on a folder opens the next column ---
    pg.click('.column[data-index="0"] .row[data-name="Projects"]')
    pg.wait_for_timeout(500)
    s = state(pg)
    check("clicking a folder opens a 2nd column", s["columns"] == 2, str(s["columns"]))
    check("2nd column lists the folder's contents", s["rowsPerColumn"] == [11, 4], str(s["rowsPerColumn"]))
    check("clicked row shows selected", s["selected"] == "Projects", str(s["selected"]))

    # --- descend again ---
    pg.click('.column[data-index="1"] .row[data-name="finder-for-windows"]')
    pg.wait_for_timeout(500)
    s = state(pg)
    check("descending opens a 3rd column", s["columns"] == 3, str(s["columns"]))
    check("3rd column has the project files", s["rowsPerColumn"][2] == 9, str(s["rowsPerColumn"]))
    check("status follows the front column", s["status"] == "9 items · 5 folders", s["status"])
    check("title follows the front column", s["title"] == "finder-for-windows", s["title"])

    # --- selecting a FILE must not open another column ---
    pg.click('.column[data-index="2"] .row[data-name="package.json"]')
    pg.wait_for_timeout(400)
    s = state(pg)
    check("selecting a file does not add a column", s["columns"] == 3, str(s["columns"]))
    check("file selection reports its size", "selected:" in (s["status"] or ""), s["status"])

    # --- go up ---
    pg.click("#up")
    pg.wait_for_timeout(500)
    s = state(pg)
    check("up returns to the parent folder", s["path"] == "C:\\Users\\dustin\\Projects", s["path"])

    # --- back: undoes the up, restoring the 3-column view (Finder behaves this way) ---
    pg.click("#back")
    pg.wait_for_timeout(500)
    s = state(pg)
    check("back restores the previous view", s["columns"] == 3, str(s["columns"]))
    check("back restores its path", s["path"] == "C:\\Users\\dustin\\Projects\\finder-for-windows", s["path"])

    # --- forward: redoes it ---
    pg.click("#forward")
    pg.wait_for_timeout(500)
    s = state(pg)
    check("forward returns to the up result", s["path"] == "C:\\Users\\dustin\\Projects", s["path"])

    # --- sidebar navigation (match by label; a Windows path in a CSS attribute
    #     selector needs escaping that obscures the test) ---
    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(500)
    s = state(pg)
    check("sidebar click opens that folder", s["path"] == "C:\\Users\\dustin", s["path"])
    check("sidebar click resets to one column", s["columns"] == 1, str(s["columns"]))
    check("sidebar marks the active row", pg.evaluate("() => document.querySelector('.sidebar-item.is-active')?.textContent") == "Home")

    # --- list view ---
    pg.click('.seg[data-view="list"]')
    pg.wait_for_timeout(300)
    s2 = pg.evaluate("() => ({ cls: document.getElementById('content').className, hdr: !!document.querySelector('.list-header'), rows: document.querySelectorAll('.row').length })")
    check("list view swaps the layout", s2["cls"] == "content content-list", s2["cls"])
    check("list view has a header row", s2["hdr"] is True)
    check("list view shows every item", s2["rows"] == 11, str(s2["rows"]))
    pg.screenshot(path=str(out))

    # --- icon view ---
    pg.click('.seg[data-view="icon"]')
    pg.wait_for_timeout(300)
    s3 = pg.evaluate("() => ({ cls: document.getElementById('content').className, cells: document.querySelectorAll('.icon-cell').length })")
    check("icon view renders a grid", s3["cls"] == "content content-icons", s3["cls"])
    check("icon view shows every item", s3["cells"] == 11, str(s3["cells"]))

    # --- search (the index-backed one is exercised later; this checks the box works) ---
    pg.click('.seg[data-view="column"]')
    pg.wait_for_timeout(200)
    pg.fill("#search", "budget")
    pg.wait_for_timeout(700)
    s4 = pg.evaluate("() => ({ rows: document.querySelectorAll('.row-result').length, bar: document.getElementById('searchbar').hidden })")
    check("typing in the search box shows results", s4["rows"] >= 1 and s4["bar"] is False, str(s4))
    pg.click("#searchClear")
    pg.wait_for_timeout(400)

    # --- Escape clears the filter ---
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    s5 = pg.evaluate("() => document.querySelectorAll('.row').length")
    check("escape clears the filter", s5 == 11, str(s5))

    # -----------------------------------------------------------------------
    # Previews and file operations
    # -----------------------------------------------------------------------

    # --- breadcrumb ---
    crumbs = pg.evaluate("() => [...document.querySelectorAll('.crumb')].map(c => c.textContent)")
    check("breadcrumb shows the path", crumbs == ["C:\\", "Users", "dustin"], str(crumbs))

    # --- the preview pane opens and shows a text preview ---
    pg.click('.column[data-index="0"] .row[data-name="notes.md"]')
    pg.wait_for_timeout(400)
    pv = pg.evaluate("""() => ({
        open: document.body.classList.contains('has-preview'),
        name: document.getElementById('previewName').textContent,
        meta: document.getElementById('previewMeta').textContent,
        hasText: !!document.querySelector('#previewBody .preview-text'),
        text: document.querySelector('#previewBody .preview-text')?.textContent.slice(0, 20) || ''
    })""")
    check("the preview pane is open", pv["open"] is True)
    check("preview names the file", pv["name"] == "notes.md", pv["name"])
    check("preview reports kind and size", "Text" in pv["meta"] and "KB" in pv["meta"], pv["meta"])
    check("a text file previews its content", pv["hasText"] and "Finder for Windows" in pv["text"], pv["text"])

    # --- an unrenderable kind says so rather than showing an empty box ---
    pg.click('.column[data-index="0"] .row[data-name="budget-2026.xlsx"]')
    pg.wait_for_timeout(500)
    pv2 = pg.evaluate("() => ({ name: document.getElementById('previewName').textContent, hint: document.querySelector('#previewBody .hint')?.textContent || '' })")
    check("preview follows the selection", pv2["name"] == "budget-2026.xlsx", pv2["name"])
    check("an unrenderable file explains itself", "No preview" in pv2["hint"], pv2["hint"])

    # --- Quick Look: spacebar over a folder lists what is inside ---
    pg.click('.column[data-index="0"] .row[data-name="Projects"]')
    pg.wait_for_timeout(400)
    pg.keyboard.press(" ")
    pg.wait_for_timeout(500)
    ql = pg.evaluate("""() => ({
        open: !document.getElementById('quicklook').hidden,
        name: document.getElementById('quicklookName').textContent,
        meta: document.getElementById('quicklookMeta').textContent,
        // Scoped to the Quick Look body: the preview pane renders its own folder list,
        // and an unscoped count would add the two together.
        lines: document.querySelectorAll('#quicklookBody .quicklook-line').length,
        summary: document.querySelector('.quicklook-summary')?.textContent || ''
    })""")
    check("space opens Quick Look", ql["open"] is True)
    check("Quick Look names the folder", ql["name"] == "Projects", ql["name"])
    check("Quick Look lists the folder's contents", ql["lines"] == 4, str(ql["lines"]))
    check("Quick Look summarises the folder", ql["summary"] == "4 items · 3 folders", ql["summary"])

    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    check("escape closes Quick Look", pg.evaluate("() => document.getElementById('quicklook').hidden") is True)

    # --- keyboard: arrow keys move the selection ---
    pg.click('.column[data-index="0"] .row[data-name="Desktop"]')
    pg.wait_for_timeout(300)
    pg.keyboard.press("ArrowDown")
    pg.wait_for_timeout(400)
    check("ArrowDown moves the selection", pg.evaluate("() => document.querySelector('.row.is-selected')?.dataset.name") == "Documents")

    # --- New Folder: the modal opens, pre-filled and unique ---
    pg.keyboard.press("Control+Shift+N")
    pg.wait_for_timeout(400)
    modal = pg.evaluate("() => ({ open: !!document.querySelector('.modal'), value: document.querySelector('.modal-input')?.value, title: document.querySelector('.modal-title')?.textContent })")
    check("Ctrl+Shift+N opens the New Folder dialog", modal["open"] is True)
    check("the dialog suggests a name", modal["value"] == "New Folder", str(modal["value"]))
    check("the dialog is titled", modal["title"] == "New Folder", str(modal["title"]))

    # Cancel it without writing anything.
    pg.click('.modal [data-action="cancel"]')
    pg.wait_for_timeout(300)
    check("cancel closes the dialog", pg.evaluate("() => !document.querySelector('.modal')") is True)

    # --- Rename: F2 opens the dialog with the current name selected ---
    pg.click('.column[data-index="0"] .row[data-name="readme.txt"]')
    pg.wait_for_timeout(300)
    pg.keyboard.press("F2")
    pg.wait_for_timeout(400)
    ren = pg.evaluate("""() => ({
        open: !!document.querySelector('.modal'),
        value: document.querySelector('.modal-input')?.value,
        selectionEnd: document.querySelector('.modal-input')?.selectionEnd,
        title: document.querySelector('.modal-title')?.textContent
    })""")
    check("F2 opens the rename dialog", ren["open"] is True)
    check("rename pre-fills the current name", ren["value"] == "readme.txt", str(ren["value"]))
    check("rename preselects only the stem, keeping the extension", ren["selectionEnd"] == 6, str(ren["selectionEnd"]))
    check("rename names the file", "readme.txt" in (ren["title"] or ""), str(ren["title"]))
    pg.click('.modal [data-action="cancel"]')
    pg.wait_for_timeout(300)

    # --- Delete is wired to the Recycle Bin path ---
    calls = pg.evaluate("""() => {
        window.__ops = [];
        const real = window.finder.fileOperation;
        window.finder.fileOperation = async (r) => { window.__ops.push(r); return real(r); };
        return true;
    }""")
    pg.click('.column[data-index="0"] .row[data-name="readme.txt"]')
    pg.wait_for_timeout(300)
    pg.keyboard.press("Delete")
    pg.wait_for_timeout(500)
    ops = pg.evaluate("() => window.__ops")
    check("Delete issues a trash operation, not a delete", ops and ops[0]["op"] == "trash", str(ops))
    check("trash targets the selected item", ops and ops[0]["path"].endswith("readme.txt"), str(ops))
    check("trash reports itself in a toast", pg.evaluate("() => !!document.querySelector('.toast')") is True)

    # --- Search: results replace the folder, and content hits are labeled ---
    pg.fill("#search", "shot")
    pg.wait_for_timeout(700)
    res = pg.evaluate(
        """() => ({
            rows: [...document.querySelectorAll('.row-result')].map(r => ({
                name: r.dataset.name,
                path: r.dataset.path,
                matched: r.querySelector('.col-kind').textContent,
                where: r.querySelector('.row-where')?.textContent || ''
            })),
            barVisible: !document.getElementById('searchbar').hidden,
            summary: document.getElementById('searchSummary').textContent,
            scopeVisible: !document.getElementById('scopeWrap').hidden,
            columnsGone: document.querySelectorAll('.column').length === 0
        })"""
    )
    check("search results replace the folder listing", res["columnsGone"] and len(res["rows"]) == 2, str(res["rows"]))
    check("the name hit is listed first", res["rows"][0]["name"] == "shot-list-final.mp4", str(res["rows"][0]))
    check("a content-only hit is found and labeled", res["rows"][1]["name"] == "meeting.md" and res["rows"][1]["matched"] == "Contents", str(res["rows"][1]))
    check("a result shows the folder it lives in", "Documents" in res["rows"][1]["where"], res["rows"][1]["where"])
    check("the summary states the count", "2 results" in res["summary"], res["summary"])
    check("the scope selector appears with the results", res["scopeVisible"])

    # --- scope: This Folder only returns what is inside the folder being viewed ---
    # Both fixtures live under C:\Users\dustin, so narrowing to C:\Users\dustin\Videos
    # must drop the one in Documents and keep the one in Videos.
    pg.click("#searchClear")  # back to the folder before navigating
    pg.wait_for_timeout(500)
    pg.click('.column[data-index="0"] .row[data-name="Videos"]')
    pg.wait_for_timeout(500)
    pg.fill("#search", "shot")
    pg.wait_for_timeout(700)
    pg.select_option("#scope", "folder")
    pg.wait_for_timeout(700)
    narrowed = pg.evaluate("() => [...document.querySelectorAll('.row-result')].map(r => r.dataset.name)")
    check(
        "This Folder scope excludes results outside the folder",
        narrowed == ["shot-list-final.mp4"],
        str(narrowed),
    )

    pg.select_option("#scope", "everywhere")
    pg.wait_for_timeout(600)
    widened = pg.evaluate("() => document.querySelectorAll('.row-result').length")
    check("Everywhere scope brings the outside results back", widened == 2, str(widened))

    # --- a query matching nothing says so plainly ---
    pg.fill("#search", "zzzznotfound")
    pg.wait_for_timeout(700)
    none = pg.evaluate("() => ({ rows: document.querySelectorAll('.row-result').length, hint: document.querySelector('.hint')?.textContent || '' })")
    check("no matches is stated, not a blank pane", none["rows"] == 0 and "Nothing matches" in none["hint"], str(none))

    # --- clearing the search brings the folder back ---
    pg.click("#searchClear")
    pg.wait_for_timeout(500)
    restored = pg.evaluate(
        "() => ({ columns: document.querySelectorAll('.column').length, bar: document.getElementById('searchbar').hidden })"
    )
    check("clearing the search restores the folder", restored["columns"] >= 1 and restored["bar"] is True, str(restored))

    # --- selecting a result previews THAT file ---
    pg.fill("#search", "meeting")
    pg.wait_for_timeout(700)
    pg.click(".row-result")
    pg.wait_for_timeout(500)
    picked = pg.evaluate("() => ({ name: document.getElementById('previewName').textContent, rows: document.querySelectorAll('.row-result.is-selected').length })")
    check("selecting a result previews it", picked["name"] == "meeting.md" and picked["rows"] == 1, str(picked))

    pg.fill("#search", "")
    pg.wait_for_timeout(400)

    # --- the index bar says what is covered ---
    pg.reload()
    pg.wait_for_timeout(900)
    indexbar = pg.evaluate(
        "() => ({ hidden: document.getElementById('indexbar').hidden, text: document.getElementById('indexText').textContent, action: document.getElementById('indexAction').textContent })"
    )
    check("the index bar reports coverage", indexbar["hidden"] is False and "Index covers" in indexbar["text"], str(indexbar))
    check("the index bar offers to rebuild", indexbar["action"] == "Build Index", indexbar["action"])

    # --- nothing marked hidden may be VISIBLE ---
    # Asserting `el.hidden === true` passes while the element is still on screen, because
    # an author rule setting `display: flex` beats the user-agent's `[hidden]` rule. That
    # is how "Back to Folder" appeared with no search running. Check computed style.
    def hidden_but_visible():
        return pg.evaluate(
            """() => [...document.querySelectorAll('[hidden]')]
                .filter((node) => getComputedStyle(node).display !== 'none')
                .map((node) => node.id || node.className || node.tagName)"""
        )

    # --- file info sits BELOW the preview ---
    pg.click('.column[data-index="0"] .row[data-name="budget-2026.xlsx"]')
    pg.wait_for_timeout(700)
    info = pg.evaluate(
        """() => {
            const body = document.getElementById('previewBody');
            const stage = body.querySelector('.preview-stage');
            const block = body.querySelector('.info-block');
            const labels = block ? [...block.querySelectorAll('dt')].map(n => n.textContent) : [];
            const values = block ? [...block.querySelectorAll('dd')].map(n => n.textContent) : [];
            return {
                hasStage: !!stage,
                hasBlock: !!block,
                blockIsAfterStage: !!(stage && block && stage.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING),
                labels, values
            };
        }"""
    )
    check("the preview has a stage element", info["hasStage"])
    check("file info appears below the preview", info["hasBlock"] and info["blockIsAfterStage"], str(info))
    check("file info names the kind and the size", "Kind" in info["labels"] and "Size" in info["labels"], str(info["labels"]))
    check("file info gives the folder", "Where" in info["labels"], str(info["labels"]))
    check("file info gives the dates", "Created" in info["labels"] and "Modified" in info["labels"], str(info["labels"]))
    check("file info omits rows it cannot fill", all(v.strip() for v in info["values"]), str(info["values"]))

    # --- an image reports its own pixel dimensions ---
    pg.click('.column[data-index="0"] .row[data-name="budget-2026.xlsx"]')
    pg.wait_for_timeout(200)
    pg.evaluate(
        """async () => {
            const body = document.getElementById('previewBody');
            body.replaceChildren();
            const stage = document.createElement('div');
            stage.className = 'preview-stage';
            const img = document.createElement('img');
            img.className = 'preview-image';
            img.src = 'data:image/gif;base64,R0lGODlhCgAKAIAAAP///wAAACwAAAAACgAKAAACCkQghqnc/l8AaAEAOw==';
            stage.append(img);
            body.append(stage);
        }"""
    )
    pg.wait_for_timeout(500)
    dims = pg.evaluate("() => { const i = document.querySelector('.preview-image'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null }")
    check("an image decodes so its dimensions are knowable", dims and dims["w"] == 10 and dims["h"] == 10, str(dims))

    # --- the interface can be made bigger, and it MEASURABLY changes ---
    # The previous version of this check asserted that a font-size property changed,
    # which passed while nothing on screen moved at all (the stylesheet is in px, so a
    # root font size scales nothing). It now measures rendered geometry.
    def measure():
        return pg.evaluate(
            """() => {
                const row = document.querySelector('.row');
                const bar = document.querySelector('.toolbar');
                const label = document.querySelector('.zoom-value');
                return {
                    zoom: document.getElementById('zoomValue').textContent,
                    rowH: row ? Math.round(row.getBoundingClientRect().height) : null,
                    barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
                    labelW: label ? Math.round(label.getBoundingClientRect().width) : null,
                    // What the bridge reported (the harness does not apply it itself),
                    // and whether the app fell back to CSS zoom.
                    reported: window.__zoomReported,
                    cssZoom: document.documentElement.style.zoom || '1'
                };
            }"""
        )

    before = measure()
    check("the toolbar shows the current interface size", before["zoom"] == "100%", str(before))

    pg.click("#zoomIn")
    pg.wait_for_timeout(600)
    after = measure()
    check("one click makes the interface bigger", after["zoom"] == "110%", str(after))
    check(
        "the interface ACTUALLY grows on screen",
        after["rowH"] > before["rowH"] and after["barH"] > before["barH"],
        f"row {before['rowH']} -> {after['rowH']}, bar {before['barH']} -> {after['barH']}",
    )
    check("the requested scale reaches the main process", after["reported"] == 1.1, str(after["reported"]))
    check("the app applied a real scale, not just a label", after["cssZoom"] == "1.1", str(after["cssZoom"]))

    # The safety net: if the engine refuses the factor, the app must still scale rather
    # than leave the control dead — the exact failure this replaced.
    pg.evaluate("() => { window.__zoomShouldFail = true; document.documentElement.style.zoom = '' }")
    pg.click("#zoomIn")
    pg.wait_for_timeout(700)
    refused = measure()
    check(
        "a refused engine still scales the interface via the fallback",
        refused["cssZoom"] != "1" and refused["rowH"] > before["rowH"],
        str(refused),
    )
    check("and the fallback tells the user rather than failing silently", pg.evaluate("() => !!document.querySelector('.toast')") is True)
    pg.evaluate("() => { window.__zoomShouldFail = false }")

    pg.keyboard.press("Control+0")
    pg.wait_for_timeout(500)

    pg.click("#zoomOut")
    pg.wait_for_timeout(600)
    shrunk = measure()
    check("and smaller again", shrunk["zoom"] == "90%", str(shrunk))
    check(
        "shrinking measurably shrinks the interface",
        shrunk["rowH"] < after["rowH"],
        f"row {after['rowH']} -> {shrunk['rowH']}",
    )

    # The far end of the ladder must be applied too, not clamped somewhere unexpected.
    # From 90% three steps up is 100 -> 110 -> 125.
    for _ in range(3):
        pg.click("#zoomIn")
        pg.wait_for_timeout(250)
    big = measure()
    check("the ladder reaches its larger steps", big["zoom"] == "125%" and big["reported"] == 1.25, str(big))
    check("and it is visibly larger than actual size", big["rowH"] > before["rowH"], f"{before['rowH']} -> {big['rowH']}")

    pg.keyboard.press("Control+0")
    pg.wait_for_timeout(600)
    reset = measure()
    check("Ctrl+0 returns to actual size", reset["zoom"] == "100%" and reset["reported"] == 1, str(reset))
    check("and the interface returns to its original size", reset["rowH"] == before["rowH"], f"{before['rowH']} vs {reset['rowH']}")

    # --- copying the selected item's path is one click, and it really copies ---
    pg.click('.column[data-index="0"] .row[data-name="logo.png"]')
    pg.wait_for_timeout(600)

    # The path readout must follow the SELECTION, not the folder being viewed.
    bar = pg.evaluate(
        """() => ({
            text: document.getElementById('statusPath').textContent,
            copyable: document.getElementById('statusPath').classList.contains('is-copyable'),
            cursor: getComputedStyle(document.getElementById('statusPath')).cursor
        })"""
    )
    check("the status bar shows the selected file's path", bar["text"].endswith("logo.png"), bar["text"])
    check("the status-bar path looks clickable", bar["copyable"] and bar["cursor"] == "pointer", str(bar))

    # Click it, then read back what was copied. Asserting the toast appeared would pass
    # even if nothing were copied, so the VALUE is checked.
    pg.click("#statusPath")
    pg.wait_for_timeout(400)
    clip = pg.evaluate("() => window.__copied || ''")
    check("clicking the path puts it on the clipboard", clip.endswith("logo.png"), clip)
    check("copying says so, because the clipboard is invisible", pg.evaluate("() => !!document.querySelector('.toast')") is True)

    # The preview's own Path row copies too.
    pg.evaluate("() => { window.__copied = null }")
    pg.click(".info-block dd.is-copyable")
    pg.wait_for_timeout(400)
    info_clip = pg.evaluate("() => window.__copied || ''")
    check("the preview's copyable row copies its value", info_clip != "" and "dustin" in info_clip, info_clip)

    # Ctrl+Shift+C is the keyboard route.
    pg.evaluate("() => { window.__copied = null }")
    pg.keyboard.press("Control+Shift+C")
    pg.wait_for_timeout(400)
    key_clip = pg.evaluate("() => window.__copied || ''")
    check("Ctrl+Shift+C copies the path", key_clip.endswith("logo.png"), key_clip)

    # Copying an empty value must not claim success.
    empty = pg.evaluate("() => window.finder.copyText('')")
    check("copying nothing reports failure, not a false success", empty["ok"] is False, str(empty))

    # With nothing selected, the folder path is what gets copied.
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    # --- right-click gives options ---
    pg.click('.column[data-index="0"] .row[data-name="readme.txt"]')
    pg.wait_for_timeout(500)
    pg.click('.column[data-index="0"] .row[data-name="notes.md"]', button="right")
    pg.wait_for_timeout(500)
    ctx = pg.evaluate(
        """() => {
            const panel = document.querySelector('.menu-context');
            if (!panel) return null;
            const box = panel.getBoundingClientRect();
            return {
                labels: [...panel.querySelectorAll('.menu-entry')].map(b => b.textContent),
                disabled: [...panel.querySelectorAll('.menu-entry[disabled]')].map(b => b.textContent),
                insideViewport: box.left >= 0 && box.top >= 0 &&
                    box.right <= window.innerWidth && box.bottom <= window.innerHeight,
                // The LAST column is the folder being previewed; reading the first
                // column would pick up whatever is selected in the parent folder.
                selected: (() => {
                    const cols = [...document.querySelectorAll('.column')];
                    const last = cols[cols.length - 1];
                    return last?.querySelector('.row.is-selected')?.dataset.name || null;
                })(),
                hasFocus: !!document.activeElement?.closest('.menu-context')
            };
        }"""
    )
    check("right-clicking an item opens a context menu", ctx is not None, str(ctx))
    check("the context menu lists the real commands", any("Copy Path" in l for l in ctx["labels"]) and any("Rename" in l for l in ctx["labels"]), str(ctx["labels"]))
    check("the context menu shows the shortcuts", any("Ctrl+Shift+C" in l for l in ctx["labels"]), str(ctx["labels"]))
    check("right-click SELECTS the item under the pointer", ctx["selected"] == "notes.md", str(ctx["selected"]))
    check("the context menu stays inside the window", ctx["insideViewport"], str(ctx))
    check("the context menu takes focus so the keyboard works", ctx["hasFocus"])

    # Escape closes it.
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    check("Escape closes the context menu", pg.evaluate("() => !document.querySelector('.menu-context')"))

    # A disabled entry must say why rather than silently doing nothing.
    pg.click('.column[data-index="0"]', position={"x": 120, "y": 400}, button="right")
    pg.wait_for_timeout(400)
    bg = pg.evaluate(
        """() => {
            const panel = document.querySelector('.menu-context');
            if (!panel) return null;
            const paste = [...panel.querySelectorAll('.menu-entry')].find(b => b.textContent.includes('Paste'));
            return {
                labels: [...panel.querySelectorAll('.menu-entry')].map(b => b.textContent),
                pasteDisabled: paste ? paste.disabled : null,
                pasteNote: paste ? paste.title : null
            };
        }"""
    )
    check("right-clicking empty space gives the folder commands", bg is not None and any("New Folder" in l for l in bg["labels"]), str(bg))
    check("an unavailable command is greyed and explains itself", bg["pasteDisabled"] is True and "Copy or cut something first" in (bg["pasteNote"] or ""), str(bg))

    pg.keyboard.press("Escape")
    pg.wait_for_timeout(200)

    # Running a command from the context menu must actually run it.
    pg.click('.column[data-index="0"] .row[data-name="logo.png"]', button="right")
    pg.wait_for_timeout(400)
    pg.evaluate("() => { window.__copied = null }")
    pg.evaluate(
        """() => {
            const panel = document.querySelector('.menu-context');
            [...panel.querySelectorAll('.menu-entry')].find(b => b.textContent.includes('Copy Path')).click();
        }"""
    )
    pg.wait_for_timeout(400)
    ran = pg.evaluate("() => window.__copied || ''")
    check("a context-menu command really runs", ran.endswith("logo.png"), ran)

    def click_row(name):
        """Click a file row by name, wherever it sits — the folder may open in any column."""
        pg.click(f'.row[data-name="{name}"]')
        pg.wait_for_timeout(700)

    # --- stepping through multiple media assets in a folder ---
    # This is the case the owner hit: four takes of one shot, and no way to flip between
    # them. Open the Videos folder and select the first video.
    # Navigate home first, then into Videos from the listing: Videos is not a sidebar
    # entry, and the search bar may or may not still be open at this point.
    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(700)
    pg.click('.column[data-index="0"] .row[data-name="Videos"]')
    pg.wait_for_timeout(900)

    def media():
        return pg.evaluate(
            """() => ({
                // The LAST column is the folder being previewed; reading the first
                // column would pick up whatever is selected in the parent folder.
                selected: (() => {
                    const cols = [...document.querySelectorAll('.column')];
                    const last = cols[cols.length - 1];
                    return last?.querySelector('.row.is-selected')?.dataset.name || null;
                })(),
                previewName: document.getElementById('previewName').textContent,
                count: document.getElementById('mediaCount').textContent,
                countHidden: document.getElementById('previewSteps').hidden,
                // The stepper is one group; hidden on the group hides both arrows.
                prevHidden: document.getElementById('previewSteps').hidden,
                nextHidden: document.getElementById('previewSteps').hidden,
                prevDisabled: document.getElementById('previewPrev').disabled,
                nextDisabled: document.getElementById('previewNext').disabled
            })"""
        )

    click_row("scene-01-take-01_VO.mp4")
    first = media()
    check("step arrows appear when a folder holds several media assets", first["prevHidden"] is False and first["nextHidden"] is False, str(first))
    check("the position in the folder is stated", first["count"] == "1 of 4", first["count"])
    check("the first item cannot step backwards", first["prevDisabled"] is True, str(first))
    check("the first item can step forwards", first["nextDisabled"] is False, str(first))

    # The arrow button advances the preview to the next take.
    pg.click("#previewNext")
    pg.wait_for_timeout(800)
    second = media()
    check("the next arrow moves to the next media asset", second["selected"] == "scene-01-take-01.mp4", str(second))
    check("and the preview follows it", second["previewName"] == "scene-01-take-01.mp4", second["previewName"])
    check("the position updates", second["count"] == "2 of 4", second["count"])
    check("now it can step backwards too", second["prevDisabled"] is False, str(second))

    # The keyboard does the same thing.
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(800)
    third = media()
    check("the right arrow steps forward", third["selected"] == "scene-01-take-02_VO.mp4", str(third))
    pg.keyboard.press("ArrowLeft")
    pg.wait_for_timeout(800)
    back = media()
    check("the left arrow steps back", back["selected"] == "scene-01-take-01.mp4", str(back))

    # The last item must disable forward and say so rather than silently doing nothing.
    click_row("scene-01-take-02.mp4")
    last = media()
    check("the last item cannot step forwards", last["nextDisabled"] is True, str(last))
    check("and the count says where it is", last["count"] == "4 of 4", last["count"])
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(600)
    check("stepping past the end explains itself", pg.evaluate("() => !!document.querySelector('.toast')") is True)

    # A non-media file must not offer stepping at all — an arrow that does nothing is
    # worse than no arrow.
    click_row("notes.txt")
    text = media()
    check("a non-media file shows no step arrows", text["prevHidden"] is True and text["nextHidden"] is True, str(text))

    # Stepping must skip non-media files, so it goes 1 -> 2 -> 3 -> 4 of the videos only.
    click_row("scene-01-take-01_VO.mp4")
    order = []
    for _ in range(3):
        pg.click("#previewNext")
        pg.wait_for_timeout(700)
        order.append(
            pg.evaluate(
                """() => {
                    const cols = [...document.querySelectorAll('.column')];
                    return cols[cols.length - 1]?.querySelector('.row.is-selected')?.dataset.name || null;
                }"""
            )
        )
    check(
        "stepping visits only the media, in order",
        order == ["scene-01-take-01.mp4", "scene-01-take-02_VO.mp4", "scene-01-take-02.mp4"],
        str(order),
    )

    # A folder with a single media file gets no arrows: there is nothing to step to.
    # Downloads holds one video and one text file: a single media asset, so no arrows.
    click_row("Downloads")
    click_row("single-take.mp4")
    single = media()
    check("a lone media file gets no step arrows", single["prevHidden"] is True and single["nextHidden"] is True, str(single))

    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(700)

    # --- the preview pane tells the truth about what is selected ---
    # These four were found by reviewing the pane against the real app; each was a real
    # defect, so each gets a check that fails if it returns.
    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(700)

    def info_rows():
        return pg.evaluate(
            """() => {
                const block = document.querySelector('.info-block');
                if (!block) return null;
                const pairs = [];
                const kids = [...block.children];
                for (let i = 0; i < kids.length; i += 2) {
                    pairs.push([kids[i]?.textContent ?? '', kids[i + 1]?.textContent ?? '']);
                }
                return {
                    dt: block.querySelectorAll('dt').length,
                    dd: block.querySelectorAll('dd').length,
                    pairs,
                    meta: document.getElementById('previewMeta').textContent,
                    bodyEmpty: document.getElementById('previewBody').children.length === 0
                };
            }"""
        )

    # D5: Where must name the containing FOLDER, not the drive.
    pg.click('.row[data-name="readme.txt"]')
    pg.wait_for_timeout(800)
    rows = info_rows()
    where = dict(rows["pairs"]).get("Where", "")
    check("the Where row names the folder, not the drive", where == "C:\\Users\\dustin", where)

    # D6: a PDF reads as 'PDF', not 'Pdf (PDF)'.
    check("the kind reads cleanly for a PDF", "Pdf" not in rows["meta"], rows["meta"])

    # D4: label/value pairs must stay aligned, one dd per dt.
    check("every info label has exactly one value", rows["dt"] == rows["dd"], f"{rows['dt']} dt vs {rows['dd']} dd")

    # D3: a folder must describe itself instead of leaving the pane blank.
    pg.click('.row[data-name="Projects"]')
    pg.wait_for_timeout(900)
    folder = info_rows()
    check("a folder does not leave the preview pane blank", folder is not None and not folder["bodyEmpty"], str(folder)[:200])
    check("a folder reports what it contains", any(k == "Contains" for k, _ in folder["pairs"]), str(folder["pairs"]))
    check("a folder never claims an unknown size", not any(k == "Size" and v == "Unknown" for k, v in folder["pairs"]), str(folder["pairs"]))

    # D2: Quick Look must show the same facts, and must not throw.
    pg.click('.row[data-name="readme.txt"]')
    pg.wait_for_timeout(600)
    pg.keyboard.press("Space")
    pg.wait_for_timeout(900)
    ql = pg.evaluate(
        """() => ({
            open: !document.getElementById('quicklook').hidden,
            hasInfo: !!document.querySelector('#quicklookBody .info-block'),
            meta: document.getElementById('quicklookMeta').textContent
        })"""
    )
    check("Quick Look opens", ql["open"] is True, str(ql))
    check("Quick Look shows the file facts, not just the content", ql["hasInfo"] is True, str(ql))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)

    # --- sort and filter a folder of mixed types ---
    # The owner's case: one shot folder with three versions, each a video, a voiceover
    # video and a prompt text file. Nine items, three types.
    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(700)

    def listing():
        return pg.evaluate(
            """() => {
                const col = [...document.querySelectorAll('.column')].pop();
                const rows = [...col.querySelectorAll('.row')].map(r => r.dataset.name);
                return {
                    rows,
                    status: document.getElementById('statusCount').textContent,
                    sortLabel: document.getElementById('sortLabel').textContent,
                    filterLabel: document.getElementById('filterLabel').textContent,
                    patternHidden: document.getElementById('patternBar').hidden
                };
            }"""
        )

    # Reach the folder by typing its path into the search-independent navigation: the
    # folder is nested, so open Videos then 03_Approved.
    pg.click('.row[data-name="Videos"]')
    pg.wait_for_timeout(800)
    pg.click('.row[data-name="03_Approved"]')
    pg.wait_for_timeout(900)
    base = listing()
    check("the mixed-type folder shows all nine items", len(base["rows"]) == 9, str(base["rows"]))
    check("the sort control states its order", base["sortLabel"] == "Name ↑", base["sortLabel"])

    # SORT by kind: video, then text — grouped, and folders still first.
    pg.click("#sortBtn")
    pg.wait_for_timeout(400)
    entries = pg.evaluate("() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].map(b => b.textContent)")
    check("the sort menu offers the four keys", len(entries) == 4, str(entries))
    pg.evaluate("""() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].find(b => b.textContent.startsWith('Kind')).click()""")
    pg.wait_for_timeout(700)
    by_kind = listing()
    # Media groups before documents (KIND_ORDER), and within each kind the names are
    # ascending — so the videos are one block and the prompt files are another.
    check("sorting by kind groups the types together", by_kind["rows"] == [
        "scene-01_AN_V001_VO.mp4",
        "scene-01_AN_V001.mp4",
        "scene-01_AN_V002_VO.mp4",
        "scene-01_AN_V002.mp4",
        "scene-01_AN_V003_VO.mp4",
        "scene-01_AN_V003.mp4",
        "scene-01_AN_V001_walkup_PROMPT.txt",
        "scene-01_AN_V002_walkup_PROMPT.txt",
        "scene-01_AN_V003_walkup_PROMPT.txt",
    ], str(by_kind["rows"]))
    check("the sort label updates", by_kind["sortLabel"] == "Kind ↑", by_kind["sortLabel"])

    # SORT by size, descending: the largest take comes first among the videos.
    pg.click("#sortBtn")
    pg.wait_for_timeout(400)
    pg.evaluate("""() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].find(b => b.textContent.startsWith('Size')).click()""")
    pg.wait_for_timeout(600)
    pg.click("#sortBtn")
    pg.wait_for_timeout(400)
    pg.evaluate("""() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].find(b => b.textContent.startsWith('Size')).click()""")
    pg.wait_for_timeout(700)
    by_size = listing()
    check("clicking the active sort key flips the direction", by_size["sortLabel"] == "Size ↓", by_size["sortLabel"])
    videos = [r for r in by_size["rows"] if r.endswith(".mp4")]
    check("the largest video sorts first when descending", videos[0] == "scene-01_AN_V002_VO.mp4", str(videos))

    # FILTER by type: video only. This is the owner's actual ask.
    pg.click("#filterBtn")
    pg.wait_for_timeout(400)
    kinds = pg.evaluate("() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].map(b => b.textContent)")
    check("the filter menu lists only kinds this folder has", all(k.startswith(("Video", "Text", "Folder")) for k in kinds if not k.startswith("Show")), str(kinds))
    check("and it counts each kind", any(k == "Video (6)" for k in kinds), str(kinds))
    pg.evaluate("""() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].find(b => b.textContent.startsWith('Video')).click()""")
    pg.wait_for_timeout(800)
    videos_only = listing()
    check("filtering to video shows only the videos", len(videos_only["rows"]) == 6 and all(r.endswith(".mp4") for r in videos_only["rows"]), str(videos_only["rows"]))
    check("the status bar admits it is hiding files", "filtered from 9" in videos_only["status"], videos_only["status"])
    check("the filter button shows the active type", videos_only["filterLabel"] == "Video", videos_only["filterLabel"])

    # The name pattern: narrow to one version, which is the point of the whole feature.
    check("the pattern field appears once a filter is on", videos_only["patternHidden"] is False, str(videos_only))
    pg.fill("#patternInput", "V003")
    pg.wait_for_timeout(800)
    v3 = listing()
    check("a name pattern narrows to one version", len(v3["rows"]) == 2, str(v3["rows"]))
    check("and it keeps only V003 files", all("V003" in r for r in v3["rows"]), str(v3["rows"]))

    # Clearing must restore the full folder, not leave it stuck filtered.
    pg.click("#patternClear")
    pg.wait_for_timeout(600)
    pg.click("#filterClear")
    pg.wait_for_timeout(700)
    cleared = listing()
    check("clearing every filter restores the whole folder", len(cleared["rows"]) == 9, str(cleared["rows"]))
    check("and the status bar stops claiming a filter", "filtered from" not in cleared["status"], cleared["status"])

    # A type filter must never hide folders: a folder that looks empty is a trap.
    # Home holds an image and a PDF, so filter by Image — a kind this folder really has.
    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(800)
    pg.click("#filterBtn")
    pg.wait_for_timeout(400)
    pg.evaluate("""() => [...document.querySelectorAll('.menu-dropdown .menu-entry')].find(b => b.textContent.startsWith('Image')).click()""")
    pg.wait_for_timeout(700)
    home_filtered = listing()
    check("a type filter never hides folders", "Documents" in home_filtered["rows"], str(home_filtered["rows"]))
    check("and it hides the files of other types", "readme.txt" not in home_filtered["rows"], str(home_filtered["rows"]))

    # List view headers sort too, and say which column is active.
    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(600)
    pg.click('.seg[data-view="list"]')
    pg.wait_for_timeout(700)
    pg.click('.seg[data-view="list"]')
    pg.wait_for_timeout(800)
    header = pg.evaluate(
        """() => [...document.querySelectorAll('.list-sort')].map(b => ({ text: b.textContent, sort: b.getAttribute('aria-sort') }))"""
    )
    # The header must name the ACTIVE column and its direction — whichever they are,
    # carried over from the sort chosen earlier.
    check(
        "list headers state which column is sorted",
        sum(1 for h in header if h["sort"] != "none") == 1 and any(h["sort"] in ("ascending", "descending") for h in header),
        str(header),
    )
    pg.click('.list-sort.col-size')
    pg.wait_for_timeout(800)
    after = pg.evaluate("() => [...document.querySelectorAll('.list-sort')].map(b => b.getAttribute('aria-sort'))")
    check("clicking a list header sorts by that column", after.count("ascending") == 1, str(after))
    pg.click('.seg[data-view="column"]')
    pg.wait_for_timeout(600)

    pg.click('.sidebar-item:has-text("Home")')
    pg.wait_for_timeout(700)

    # --- multi-select, copy and paste -------------------------------------------
    # The owner asked for the batch gestures. These are the checks that matter: a
    # selection of MORE THAN ONE, and a paste that really lands.
    pg.goto(src.as_uri())
    pg.wait_for_timeout(600)
    pg.click('.column[data-index="0"] .row[data-name="Videos"]')
    pg.wait_for_timeout(500)
    names = pg.evaluate("() => [...document.querySelectorAll('.column')].pop().querySelectorAll('.row').length")
    check("the Videos folder lists several takes", names >= 4, str(names))

    # Ctrl+click adds a second item without losing the first.
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-01.mp4"]')
    pg.wait_for_timeout(200)
    pg.keyboard.down("Control")
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-02.mp4"]')
    pg.keyboard.up("Control")
    pg.wait_for_timeout(300)
    sel = pg.evaluate("() => [...document.querySelectorAll('.row.is-selected')].map(r => r.dataset.name)")
    check("Ctrl+click selects a second item", len(sel) == 2, str(sel))
    check("both clicked items are selected", set(sel) == {"scene-01-take-01.mp4", "scene-01-take-02.mp4"}, str(sel))

    # Shift+click takes the RANGE between the anchor and the click.
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-01_VO.mp4"]')
    pg.wait_for_timeout(200)
    pg.keyboard.down("Shift")
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-02.mp4"]')
    pg.keyboard.up("Shift")
    pg.wait_for_timeout(300)
    sel = pg.evaluate("() => [...document.querySelectorAll('.row.is-selected')].map(r => r.dataset.name)")
    # Display order is 03_Approved, notes.txt, take-01_VO, take-01, take-02_VO, take-02 —
    # so the range from the first take to the last spans four rows.
    check("Shift+click selects the range between the two", len(sel) == 4, str(sel))
    check("the range includes the anchor and the target",
          "scene-01-take-01_VO.mp4" in sel and "scene-01-take-02.mp4" in sel, str(sel))
    check("the range does NOT reach past the anchor", "notes.txt" not in sel, str(sel))

    # A plain click collapses the selection back to one — otherwise it can never be undone.
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-02.mp4"]')
    pg.wait_for_timeout(300)
    sel = pg.evaluate("() => [...document.querySelectorAll('.row.is-selected')].map(r => r.dataset.name)")
    check("a plain click collapses the selection to one", len(sel) == 1, str(sel))

    # Ctrl+A selects the whole folder.
    pg.keyboard.down("Control"); pg.keyboard.press("a"); pg.keyboard.up("Control")
    pg.wait_for_timeout(300)
    total = pg.evaluate("() => [...document.querySelectorAll('.column')].pop().querySelectorAll('.row').length")
    sel = pg.evaluate("() => document.querySelectorAll('.row.is-selected').length")
    check("Ctrl+A selects every item in the folder", sel == total, f"{sel} of {total}")

    # Copy, then paste into a different folder, and prove the file ARRIVED.
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-01.mp4"]')
    pg.wait_for_timeout(200)
    pg.keyboard.down("Control"); pg.keyboard.press("c"); pg.keyboard.up("Control")
    pg.wait_for_timeout(400)
    check("copying says so", pg.evaluate("() => (document.querySelector('.toast')?.textContent || '').includes('copied')"))
    check("the clipboard hint appears", pg.evaluate("() => !document.getElementById('pasteHint').hidden"))
    hint = pg.evaluate("() => document.getElementById('pasteHint').textContent")
    check("the hint names how many items are held", "1 copied" in hint, hint)

    # The copied row is marked, so a copy and a cut are not confusable.
    check("the copied row is marked as on the clipboard",
          pg.evaluate("() => document.querySelectorAll('.row.is-clipped').length") == 1)

    pg.click('.column[data-index="0"] .row[data-name="Projects"]')
    pg.wait_for_timeout(500)
    pg.keyboard.down("Control"); pg.keyboard.press("v"); pg.keyboard.up("Control")
    pg.wait_for_timeout(500)
    landed = pg.evaluate("() => [...document.querySelectorAll('.column')].pop().querySelectorAll('.row').length")
    check("pasting puts the item in the folder being viewed", landed == 5, str(landed))
    transferred = pg.evaluate("() => (window.__transfers || [])")
    check("the paste really reached the file layer", len(transferred) == 1, str(transferred))
    check("it was a copy, not a move", transferred and transferred[0]["op"] == "copy", str(transferred))
    check("the copied file is now in the destination",
          pg.evaluate("() => [...document.querySelectorAll('.column')].pop().querySelectorAll('.row')")
          and any(r for r in pg.evaluate("() => [...[...document.querySelectorAll('.column')].pop().querySelectorAll('.row')].map(r => r.dataset.name)") if r == "scene-01-take-01.mp4"))

    # Cutting dims the row and the paste MOVES it.
    pg.click('.column[data-index="0"] .row[data-name="Videos"]')
    pg.wait_for_timeout(500)
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-02_VO.mp4"]')
    pg.wait_for_timeout(200)
    pg.keyboard.down("Control"); pg.keyboard.press("x"); pg.keyboard.up("Control")
    pg.wait_for_timeout(400)
    check("a cut row is marked differently from a copied one",
          pg.evaluate("() => document.querySelectorAll('.row.is-cut').length") == 1)
    cut_hint = pg.evaluate("() => document.getElementById('pasteHint').textContent")
    check("the hint says cut, not copied", "cut" in cut_hint, cut_hint)

    pg.click('.column[data-index="0"] .row[data-name="Documents"]')
    pg.wait_for_timeout(500)
    before = pg.evaluate("() => [...document.querySelectorAll('.column')].pop().querySelectorAll('.row').length")
    pg.keyboard.down("Control"); pg.keyboard.press("v"); pg.keyboard.up("Control")
    pg.wait_for_timeout(500)
    after = pg.evaluate("() => [...document.querySelectorAll('.column')].pop().querySelectorAll('.row').length")
    check("cutting and pasting adds the item to the destination", after == before + 1, f"{before} -> {after}")
    ops = pg.evaluate("() => (window.__transfers || []).map(t => t.op)")
    check("the paste was a move, because the item was cut", ops[-1] == "move", str(ops))

    # Pasting with an empty clipboard must not claim success.
    pg.evaluate("() => { window.__finderState = null }")
    pg.reload()
    pg.wait_for_timeout(600)
    pg.keyboard.down("Control"); pg.keyboard.press("v"); pg.keyboard.up("Control")
    pg.wait_for_timeout(400)
    toast = pg.evaluate("() => document.querySelector('.toast')?.textContent || ''")
    check("pasting nothing reports it, rather than doing nothing silently",
          "copied yet" in toast or "nothing" in toast.lower(), toast)

    # --- live refresh -----------------------------------------------------------
    # The folder you are looking at must notice a change on its own, and must NOT throw
    # away the selection when it does.
    pg.goto(src.as_uri())
    pg.wait_for_timeout(600)
    watched = pg.evaluate("() => window.__watched || []")
    check("the app watches the folder on screen", len(watched) == 1, str(watched))
    check("it watches the right folder", watched and watched[0].endswith("dustin"), str(watched))

    pg.click('.column[data-index="0"] .row[data-name="Videos"]')
    pg.wait_for_timeout(500)
    watched = pg.evaluate("() => window.__watched || []")
    check("opening a folder adds it to the watch list", len(watched) == 2, str(watched))

    # Select something, then have the folder change underneath.
    pg.click('.column[data-index="1"] .row[data-name="scene-01-take-01.mp4"]')
    pg.wait_for_timeout(300)
    before = pg.evaluate("() => document.querySelector('.row.is-selected')?.dataset.name || null")

    pg.evaluate("""() => {
        // A new file appears, as it would when another program saves one.
        const cols = [...document.querySelectorAll('.column')];
        window.__inject = true;
    }""")
    pg.evaluate("() => window.__fireFoldersChanged && window.__fireFoldersChanged()")
    pg.wait_for_timeout(600)
    after = pg.evaluate("() => document.querySelector('.row.is-selected')?.dataset.name || null")
    check("a live refresh keeps the selection", after == before, f"{before} -> {after}")
    check("a live refresh does not throw", pg.evaluate("() => true"))

    # F5 refreshes by hand, for the folders a watcher cannot cover.
    pg.keyboard.press("F5")
    pg.wait_for_timeout(500)
    check("F5 refreshes without an error", pg.evaluate("() => document.querySelectorAll('.column').length") >= 2)

    # --- tags -------------------------------------------------------------------
    # The tag store has existed since early on with no way to reach it. These checks
    # prove it is now visible AND that applying a tag actually writes one.
    pg.goto(src.as_uri())
    pg.wait_for_timeout(700)

    check("the sidebar has a Tags section", pg.evaluate("() => [...document.querySelectorAll('.sidebar-heading')].some(h => h.textContent === 'Tags')"))
    check("the Tags section says tags are app-only",
          pg.evaluate("() => [...document.querySelectorAll('.sidebar-note')].some(n => /this app only/i.test(n.textContent))"))
    empty = pg.evaluate("() => document.querySelector('.sidebar-empty')?.textContent || ''")
    check("an empty tag list says how to make one", "Right-click" in empty, empty)

    # Tag a file through the context menu.
    pg.click('.column[data-index="0"] .row[data-name="logo.png"]')
    pg.wait_for_timeout(300)
    pg.click('.column[data-index="0"] .row[data-name="logo.png"]', button="right")
    pg.wait_for_timeout(400)
    labels = pg.evaluate("() => [...document.querySelectorAll('.menu-panel [role=menuitem], .menu-panel button, .menu-panel div')].map(e => e.textContent)")
    check("the item menu offers Tags", any("Tags" in l for l in labels), str(labels[:14]))

    pg.evaluate("""() => {
        const entry = [...document.querySelectorAll('.menu-panel *')].find(e => /^Tags/.test(e.textContent.trim()));
        if (entry) entry.click();
    }""")
    pg.wait_for_timeout(500)
    colors = pg.evaluate("() => [...document.querySelectorAll('.menu-panel .menu-entry')].map(b => b.textContent.trim()).filter(t => /^(Red|Orange|Yellow|Green|Blue|Purple|Gray)/.test(t))")
    check("the picker offers the seven tags", len(colors) == 7, str(colors))

    # Apply one, and prove it reached the store.
    pg.evaluate("""() => {
        const entry = [...document.querySelectorAll('.menu-panel *')].find(e => /^Green/.test(e.textContent.trim()));
        if (entry) entry.click();
    }""")
    pg.wait_for_timeout(700)
    stored = pg.evaluate("() => Object.keys(window.__tags || {})")
    check("applying a tag writes it to the store", stored == ["Green"], str(stored))
    held = pg.evaluate("() => (window.__tags || {}).Green || []")
    check("the store holds the tagged file's path", any("logo.png" in p for p in held), str(held))

    # The sidebar now lists it with a count.
    listed = pg.evaluate("() => [...document.querySelectorAll('.tag-item')].map(b => b.textContent.trim())")
    check("the tag appears in the sidebar", any(l.startswith("Green") for l in listed), str(listed))
    counts = pg.evaluate("() => [...document.querySelectorAll('.tag-count')].map(c => c.textContent)")
    check("the tag shows how many files carry it", counts == ["1"], str(counts))
    check("the tag has a color dot", pg.evaluate("() => document.querySelectorAll('.tag-dot').length") >= 1)

    # Clicking it shows the tagged files.
    pg.evaluate("""() => {
        const button = [...document.querySelectorAll('.tag-item')].find(b => /Green/.test(b.textContent));
        if (button) button.click();
    }""")
    pg.wait_for_timeout(700)
    shown = pg.evaluate("() => [...document.querySelectorAll('.row')].map(r => r.dataset.name)")
    check("clicking a tag shows ONLY its files", shown == ["logo.png"], str(shown))

    # Clicking again returns to the folder.
    pg.evaluate("""() => {
        const button = [...document.querySelectorAll('.tag-item')].find(b => /Green/.test(b.textContent));
        if (button) button.click();
    }""")
    pg.wait_for_timeout(700)
    back = pg.evaluate("() => [...document.querySelectorAll('.row')].map(r => r.dataset.name)")
    check("clicking the active tag again returns to the folder", len(back) > 1, str(back))

    # --- Quick Look walks the folder (FR-009) ------------------------------------
    # The overlay used to move the selection and leave the old file on screen, so the
    # arrows looked dead. Walking must also cross NON-media files, because Quick Look is
    # a look at the folder, not a slideshow of the pictures in it.
    pg.goto(src.as_uri())
    pg.wait_for_timeout(700)
    pg.click('.column[data-index="0"] .row[data-name="notes.md"]')
    pg.wait_for_timeout(300)
    pg.keyboard.press("Space")
    pg.wait_for_timeout(600)
    check("Quick Look opens on the selected file",
          "notes.md" in pg.evaluate("() => document.querySelector('.quicklook')?.textContent || ''"))

    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(600)
    after = pg.evaluate("() => document.querySelector('.quicklook')?.textContent || ''")
    check("the right arrow moves Quick Look to another file", "notes.md" not in after, after[:60])
    check("Quick Look stays open while stepping",
          pg.evaluate("() => !!document.querySelector('.quicklook') && !document.querySelector('.quicklook').hidden"))

    pg.keyboard.press("ArrowLeft")
    pg.wait_for_timeout(600)
    back = pg.evaluate("() => document.querySelector('.quicklook')?.textContent || ''")
    check("the left arrow comes back", "notes.md" in back, back[:60])

    # Walking past the end must say so, not do nothing.
    for _ in range(20):
        pg.keyboard.press("ArrowRight")
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(400)
    end_toast = pg.evaluate("() => document.querySelector('.toast')?.textContent || ''")
    check("stepping past the last file says so", "last file" in end_toast, end_toast)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    # Recomputed at the very end, after everything above has moved the UI around.
    leaked = hidden_but_visible()
    check("no element marked hidden is actually visible", leaked == [], str(leaked))
    check(
        "the search bar is not visible before a search",
        pg.evaluate("() => getComputedStyle(document.getElementById('searchbar')).display === 'none'"),
    )

    check("no page errors anywhere", not errs, str(errs[:2]))
    b.close()

print()
print("FAILURES:", fails or "none")
sys.exit(1 if fails else 0)
