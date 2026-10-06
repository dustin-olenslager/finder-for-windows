# Finder for Windows

A Windows file manager that works like macOS Finder.

Built for Windows on ARM64 (Snapdragon X) with an x64 build from the same source.

## Status

**Pre-release.** The foundation is in place; the interface is being built. See
[`docs/agents/roadmap.md`](docs/agents/roadmap.md) for what is committed and
[`docs/agents/in-progress.md`](docs/agents/in-progress.md) for what is next.

## What it will do

- Browse folders with a Finder sidebar, a Column (Miller) view by default, plus
  Icon, List and Gallery views
- Preview any file with the spacebar — images, PDF, video, audio, text and code,
  Office documents — and walk through a folder with the arrow keys while the
  preview stays open
- Search file names **and file contents**, with saved searches in the sidebar
- Tag files with color-coded tags that show as dots beside the filename
- Remember how each folder was last viewed
- Copy, move, rename, duplicate and delete with undo, sending deletions to the
  Windows Recycle Bin

## What it deliberately does not do

It does not replace Windows Explorer and never changes any Windows setting, file
association or default handler. It is a separate app you open when you want it.

Finder features that depend on macOS itself — system-wide tags, Spotlight, Quick
Look as a system service, AirDrop, iCloud Drive placeholders, Finder aliases —
are out of scope, because Windows has no equivalent to hook into. Where one of
them matters, this app provides its own version, and says so in the interface.

## Search

Type in the search box and the results replace the folder listing, showing the folder
each hit lives in and whether the match was the **name** or the **contents**.

- **Scope:** *Everywhere* (the default) or *This Folder*.
- **Terms:** `shot list` requires both words, `-draft` excludes one, `"shot list"`
  requires the phrase.
- Matching is whole-word, so `cat` does not match `concatenate`.
- **Build Index** walks the drives: file names first, then the contents of text, code,
  PDF and Office files under a size cap. The bar reports how many files are covered and
  Stop cancels the scan.
- `node_modules`, `C:\Windows`, `C:\Program Files` and the Recycle Bin are never indexed.

Tags live in the app's own store, because Windows has no shared metadata store — they
are visible here and not in Explorer, and the interface says so.

## Building

Requires Node 22+.

```
npm install
npm start             # run the app locally
npm test              # unit tests
npm run verify:index  # build a real index over a temp tree and search it
npm run build         # ARM64 installer -> dist/
npm run build:x64     # x64 installer -> dist/
```

The Windows installers are built by the `build-windows` GitHub Actions workflow,
which runs on a Windows runner. Locally on Linux you can run the tests and the
app, but the NSIS installer target needs Windows or wine.

## License

MIT — see [LICENSE](LICENSE).
