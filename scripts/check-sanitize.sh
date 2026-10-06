#!/usr/bin/env bash
# Gate: no private or identifying information in this public repository.
#
# This repo is public and MIT. Anything committed is world-readable and permanent, so
# the check runs over TRACKED FILES (what would actually be published) and fails the
# build rather than relying on someone remembering to look.
#
# Why this exists: production naming from private work was once typed into a test
# fixture here. A fixture is not "just test data" — it is published content.

set -euo pipefail

cd "$(dirname "$0")/.."

# Private names: projects, employers, hosts, internal infrastructure. Extended regex
# only — no lookaheads, because grep -E does not support them.
PRIVATE_PATTERN='joeybuilt|nexalog|humble[-_ ]?house|frameforge|10[-_ ]?ton|srv1713099|192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+'

# Any contact address at all. The repository's own GitHub noreply is allowed through
# the filter below; everything else is a finding.
EMAIL_PATTERN='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'

# Strings that are legitimately public in this repo: the owner's name, the project's
# own GitHub address, and the GitHub noreply used for authorship.
# Also allowed: RFC 2606 / RFC 6761 reserved test domains. These are the standard
# placeholders for a git identity in a test script and identify nobody.
ALLOW='dustin-olenslager@users\.noreply\.github\.com|dustin-olenslager\.github\.io|github\.com/dustin-olenslager|Dustin Olenslager|@example\.(com|org|invalid)|@example|@e\.invalid|@test\.invalid'

fail=0

scan() {
  local label="$1" pattern="$2"
  # Tracked files only (exactly what would be published); -I skips binary assets.
  # The gate script itself is excluded: it has to name these strings in order to ban
  # them, and it is the definition of the rule rather than a violation of it.
  local hits
  hits=$(git grep -InE "$pattern" -- . ':!package-lock.json' ':!*.ico' ':!*.png' ':!scripts/check-sanitize.sh' 2>/dev/null \
    | grep -viE "$ALLOW" || true)
  if [ -n "$hits" ]; then
    echo "FAIL  $label"
    echo "$hits" | sed 's/^/      /'
    fail=1
  else
    echo "ok    $label"
  fi
}

echo "Sanitize check — this repository is public."
scan "no private project or host names" "$PRIVATE_PATTERN"
scan "no non-noreply contact addresses" "$EMAIL_PATTERN"

if [ "$fail" -ne 0 ]; then
  echo
  echo "Private information must not be published. Replace the fixture data or remove the"
  echo "reference — do not add an exception unless the string is genuinely public."
  exit 1
fi

echo "sanitize: OK — nothing private in tracked files"
