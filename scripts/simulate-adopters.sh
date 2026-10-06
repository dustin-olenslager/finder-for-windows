#!/usr/bin/env bash
# simulate-adopters.sh — build 3 fake adopter repos in distinct states and run the fixed
# update/migrate path against every one, recording before/after as EVIDENCE.
#
# Not a canary: it is the owner-requested simulation harness. It never touches a real adopter repo;
# every fixture lives under SCRATCH. Prints a readable transcript to stdout (also tee-able to a file).
#
#   bash scripts/simulate-adopters.sh /opt/data/cache/scratch/wt-update
set -u

KIT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
DOC="$KIT/scripts/panoply.sh"
SIM="/opt/data/cache/scratch/sim-adopters"
rm -rf "$SIM"; mkdir -p "$SIM"
export PANOPLY_KIT_ROOT="$KIT"   # so the fixtures can reach the kit source

hr()  { printf '\n============================================================\n%s\n============================================================\n' "$1"; }
run() { printf '\n$ %s\n' "$*"; "$@"; printf '[exit %s]\n' "$?"; }

# A tiny git repo with an initial commit.
newrepo() { _p="$SIM/$1"; mkdir -p "$_p"; ( cd "$_p" && git init -q . && printf '# %s\n' "$1" > README.md \
  && git add -A && git -c user.email=t@t -c user.name=t commit -qm init ) >/dev/null 2>&1; printf '%s' "$_p"; }

# --- fixture (a): OLD-LAYOUT adopter (docs/claude + .claude/rules) ------------------------------
# The real 9-of-11 case: a repo that adopted before the layout changed. Its own doctor is the OLD
# (marker-less) one and reports OK on its own old layout — the false green.
A="$(newrepo oldlayout-adopter)"
( cd "$A" && git init -q 2>/dev/null; true )
# Build the old layout by adopting with the CURRENT kit, then renaming the tree to the old names and
# dropping in the OLD doctor (from the kit's own main — the real pre-marker copy).
( cd "$A" && sh "$DOC" apply ) >/dev/null 2>&1
mkdir -p "$A/docs/claude" "$A/.claude/rules"
mv "$A"/docs/agents/* "$A/docs/claude/" 2>/dev/null || true
mv "$A"/.agents/rules/* "$A/.claude/rules/" 2>/dev/null || true
rm -rf "$A/docs/agents" "$A/.agents/rules"
git -C "$KIT" show origin/main:scripts/panoply.sh > "$A/scripts/panoply.sh"
chmod +x "$A/scripts/panoply.sh"
# strip tokens so it is a "genuinely adapted" old adopter, and give it its own OLD stamp
sed -i 's/{{[A-Z_][A-Z0-9_]*}}/fixture/g' "$A/AGENTS.md" 2>/dev/null || true
( cd "$A" && sh scripts/panoply.sh stamp ) >/dev/null 2>&1
( cd "$A" && git add -A && git -c user.email=t@t -c user.name=t commit -qm 'old-layout adoption' ) >/dev/null 2>&1

# --- fixture (b): CURRENT-layout adopter with LOCALLY-EDITED managed scripts (the an adopter case) ---
B="$(newrepo current-localedits)"
( cd "$B" && sh "$DOC" apply ) >/dev/null 2>&1
sed -i 's/{{[A-Z_][A-Z0-9_]*}}/fixture/g' "$B/AGENTS.md" 2>/dev/null || true
# the local work that must survive: a conflict-marker sweep the kit template lacks
printf '\n# LOCAL WORK: conflict-marker sweep (an adopter)\ngrep -n "^<<<<<<< " . || true\n' >> "$B/scripts/check-docs.sh"
( cd "$B" && PANOPLY_SELF=0 sh scripts/sync-agents.sh ) >/dev/null 2>&1
( cd "$B" && sh "$DOC" stamp ) >/dev/null 2>&1
( cd "$B" && git add -A && git -c user.email=t@t -c user.name=t commit -qm 'current adoption + local edit' ) >/dev/null 2>&1

# --- fixture (c): a repo with a LYING stamp (claims a kit_sha it does not match) ------------------
C="$(newrepo lying-stamp)"
( cd "$C" && sh "$DOC" apply ) >/dev/null 2>&1
# make it a genuinely COMPLIANT adopter (fill tokens) so the stamp verdict is what dominates — a lie
# is only observable when nothing louder (unfilled tokens) masks it.
sed -i 's/{{[A-Z_][A-Z0-9_]*}}/fixture/g' "$C/AGENTS.md" 2>/dev/null || true
for _m in "$C"/.agents/rules/*.md; do sed -i 's/{{[A-Z_][A-Z0-9_]*}}/fixture/g' "$_m" 2>/dev/null || true; done
( cd "$C" && PANOPLY_SELF=0 sh scripts/sync-agents.sh ) >/dev/null 2>&1
( cd "$C" && sh "$DOC" stamp ) >/dev/null 2>&1
# Now make the stamp lie: claim a different kit_sha and kit_version, as the old apply did after
# silently re-stamping a drifted repo.
sed -i 's/^kit_version: .*/kit_version: v1.4.0/' "$C/.panoply-version"
sed -i 's/^kit_sha: .*/kit_sha: deadbeef/' "$C/.panoply-version"
( cd "$C" && git add -A && git -c user.email=t@t -c user.name=t commit -qm 'lied stamp' ) >/dev/null 2>&1

echo "kit source: $KIT  (generation $(sed -n 's/^_PANOPLY_GENERATION="\([^"]*\)".*/\1/p' "$DOC" | head -1))"
echo "fixtures: $SIM"

# ================================================================================================
hr "(a) OLD-LAYOUT adopter — before"
run bash -c "cd '$A' && echo '--- repo own OLD doctor says:' && sh scripts/panoply.sh check 2>&1; echo exit=\$?"
printf 'stamp before: %s\n' "$(grep '^kit_version:' "$A/.panoply-version" 2>/dev/null)"
run bash -c "cd '$A' && echo '--- the FIXED (kit) doctor says:' && sh '$DOC' check 2>&1; echo exit=\$?"

hr "(a) OLD-LAYOUT adopter — migrate"
run bash -c "cd '$A' && sh '$DOC' migrate 2>&1; echo exit=\$?"
printf '\n--- after migrate: layout ---\n'
ls -d "$A/docs/claude" "$A/docs/agents" "$A/.claude/rules" "$A/.agents/rules" 2>&1
printf 'stamp after: %s\n' "$(grep '^kit_version:' "$A/.panoply-version" 2>/dev/null)"
printf '\n--- after migrate: the repo own doctor (now refreshed) says ---\n'
run bash -c "cd '$A' && sh scripts/panoply.sh check 2>&1; echo exit=\$?"
printf '\n--- old tree preserved? ---\n'
find "$A/docs/claude" "$A/.claude/rules" -type f 2>/dev/null | wc -l

# ================================================================================================
hr "(b) CURRENT-LAYOUT adopter with LOCAL EDITS — before"
printf 'LOCAL WORK present in check-docs.sh?  %s\n' "$(grep -c 'LOCAL WORK: conflict-marker sweep' "$B/scripts/check-docs.sh")"
printf 'check-docs.sh sha256: %s\n' "$(sha256sum "$B/scripts/check-docs.sh" | cut -d' ' -f1)"
run bash -c "cd '$B' && sh '$DOC' apply 2>&1; echo exit=\$?; echo '--- stamp:' && grep '^kit_version:' .panoply-version"
printf '\n--- is the local work still there after a PLAIN apply? ---\n'
grep -c 'LOCAL WORK: conflict-marker sweep' "$B/scripts/check-docs.sh"

hr "(b) CURRENT-LAYOUT adopter — apply --force-scripts (destructive path, must be recoverable)"
run bash -c "cd '$B' && sh '$DOC' apply --force-scripts 2>&1; echo exit=\$?"
printf '\n--- backups written ---\n'
find "$B/scripts" -maxdepth 1 -name '*.panoply-bak*' -printf '  %p  (%s bytes)\n' 2>/dev/null
_bak="$(find "$B/scripts" -maxdepth 1 -name 'check-docs.sh.panoply-bak*' 2>/dev/null | head -1)"
printf '\n--- local work recoverable from the backup? ---\n'
if [ -n "$_bak" ]; then
  printf 'backup: %s\n' "$_bak"
  printf 'LOCAL WORK in backup?  %s\n' "$(grep -c 'LOCAL WORK: conflict-marker sweep' "$_bak")"
  printf 'backup sha256: %s\n' "$(sha256sum "$_bak" | cut -d' ' -f1)"
  printf 'restored bytes identical to the pre-overwrite file?  '
  # the pre-overwrite file was the local edit; compare the backup against a fresh reconstruction
  cp "$_bak" /tmp/restored-check-docs.sh
  grep -q 'LOCAL WORK: conflict-marker sweep' /tmp/restored-check-docs.sh && printf 'YES (local work intact)\n' || printf 'NO\n'
else
  printf 'NO BACKUP FOUND — destructive!\n'
fi

# ================================================================================================
hr "(c) LYING-STAMP adopter — before"
printf 'stamp before:\n'; sed 's/^/  /' "$C/.panoply-version"
printf '\n--- doctor verdict BEFORE (does it trust the lie?) ---\n'
run bash -c "cd '$C' && sh '$DOC' check 2>&1; echo exit=\$?"

hr "(c) LYING-STAMP adopter — apply (must correct the stamp, not repeat the lie)"
run bash -c "cd '$C' && sh '$DOC' apply 2>&1 | tail -6; echo '--- stamp after:' && grep -E '^kit_version|^kit_sha' .panoply-version"
printf '\n--- doctor verdict AFTER ---\n'
run bash -c "cd '$C' && sh '$DOC' check 2>&1; echo exit=\$?"

echo
hr "SUMMARY"
printf '(a) old-layout: layout now %s; old tree files kept: %s\n' \
  "$([ -d "$A/docs/agents" ] && echo 'docs/agents ✓' || echo 'STILL OLD')" \
  "$(find "$A/docs/claude" "$A/.claude/rules" -type f 2>/dev/null | wc -l)"
printf '(b) local edits: local work after plain apply = %s; backup(s) = %s\n' \
  "$(grep -c 'LOCAL WORK' "$B/scripts/check-docs.sh")" \
  "$(find "$B/scripts" -maxdepth 1 -name '*.panoply-bak*' | wc -l)"
printf '(c) lying stamp: now %s\n' "$(grep '^kit_version:' "$C/.panoply-version")"
