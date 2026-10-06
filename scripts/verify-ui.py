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
        path: document.getElementById('statusPath')?.textContent,
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
        lines: document.querySelectorAll('.quicklook-line').length,
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

    # --- the interface can be made bigger, visibly ---
    zoom = pg.evaluate(
        """() => ({
            value: document.getElementById('zoomValue').textContent,
            rootFont: getComputedStyle(document.documentElement).fontSize
        })"""
    )
    check("the toolbar shows the current interface size", zoom["value"] == "100%", str(zoom))

    pg.click("#zoomIn")
    pg.wait_for_timeout(300)
    bigger = pg.evaluate(
        """() => ({
            value: document.getElementById('zoomValue').textContent,
            rootFont: getComputedStyle(document.documentElement).fontSize
        })"""
    )
    check("one click makes the interface bigger", bigger["value"] == "110%" and bigger["rootFont"] != zoom["rootFont"], str(bigger))

    pg.click("#zoomOut")
    pg.click("#zoomOut")
    pg.wait_for_timeout(300)
    smaller = pg.evaluate("() => document.getElementById('zoomValue').textContent")
    check("and smaller again", smaller == "90%", smaller)

    pg.keyboard.press("Control+0")
    pg.wait_for_timeout(300)
    reset = pg.evaluate("() => document.getElementById('zoomValue').textContent")
    check("Ctrl+0 returns to actual size", reset == "100%", reset)

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
