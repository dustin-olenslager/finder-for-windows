# Decision log — finder-for-windows

Durable record of owner decisions. A question asked in chat can time out and be lost; this file
is the home of record. **Status: `open` items are waiting on the owner.**

## D-0001 — What kind of Finder clone?

- **Status:** open
- **Question:** "Functions exactly like Mac Finder" has three readings. Which is the target?
- **Options:**
  1. **Behavioral clone** — same views, shortcuts, tags, sidebar, Quick Look semantics. ~90% of
     Finder is achievable on Windows. *SME-recommended.*
  2. Metadata clone — tags/comments/view-state visible to other apps and Windows itself.
     **Not possible on Windows** (no cross-application metadata store).
  3. Skin clone — looks identical, does not behave identically. Rejected by the SME panel.

## D-0002 — Default view for a new folder

- **Status:** open
- **Question:** Which view opens by default on a folder with no remembered state?
- **Options:**
  1. **Column (Miller) view** — the Finder-defining power view; the hardest to retrofit later.
     *SME-recommended.*
  2. Icon view
  3. List view
  4. Gallery view (big preview + filmstrip)
- **Note:** every folder still remembers its own last-used view; this is only the initial default.

## D-0003 — v1 scope

- **Status:** open
- **Question:** How much ships in v1?
- **Options:**
  1. **Fast core first** — all four views, Quick Look, tags, sidebar, full keyboard grammar,
     per-folder view memory; search covers name/kind/date. *SME-recommended.*
  2. Fast core **plus** a full content-indexing search engine in v1 (materially bigger).
  3. Minimal MVP — icon + list views and basic file operations only.

## D-0004 — Where tags live

- **Status:** open
- **Question:** Finder tags have nowhere to live on Windows. Where are they stored?
- **Options:**
  1. **App-local tag database** — a sidecar SQLite file keyed by volume serial + NTFS file ID.
     Works on every filesystem including USB and network drives. Tags are visible only inside
     this app. *SME-recommended.*
  2. Write tags into NTFS file metadata (alternate data streams) so Windows Explorer sees them —
     lost on FAT/exFAT/network copies, and antivirus flags ADS writes.
  3. Both — the app database is the source of truth, plus a one-click "export tags to Windows".
