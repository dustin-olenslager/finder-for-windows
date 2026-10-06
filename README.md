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

## Building

Requires Node 22+.

```
npm install
npm start          # run the app locally
npm test           # run the test suite
npm run build      # ARM64 installer -> dist/
npm run build:x64  # x64 installer -> dist/
```

The Windows installers are built by the `build-windows` GitHub Actions workflow,
which runs on a Windows runner. Locally on Linux you can run the tests and the
app, but the NSIS installer target needs Windows or wine.

## License

MIT — see [LICENSE](LICENSE).
