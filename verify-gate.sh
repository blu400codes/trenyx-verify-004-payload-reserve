#!/usr/bin/env bash
# trenyx verify-gate — mechanical pre-publish checks for an engagement repo.
# Refuses (exit 1) on the classes of error that agents share and machines don't:
#   1. any *.sha256 in the tree fails `shasum -c`  (hashed docs must never be edited)
#   2. a hand-typed clock time appears in a document without a git/date anchor
#   3. build artifacts are tracked (.pyc, __pycache__, .pytest_cache)
#   4. the receipt is older than any artifact it hashes
# Run from the repo root before every push:  ./verify-gate.sh
set -u; fail=0
say(){ printf '%s\n' "$*"; }

# 1) hashes
while IFS= read -r f; do
  d=$(dirname "$f"); ( cd "$d" && shasum -a 256 -c "$(basename "$f")" >/dev/null 2>&1 ) \
    || { say "FAIL hash: $f does not verify (a hashed document was edited?)"; fail=1; }
done < <(git ls-files '*.sha256' | grep -v '^05-receipt/')   # receipts are root-relative: check 4

# 2) hand-typed times: HH:MM in prose must be followed by a zone (EDT/EST/UTC/Z) or sit on a line with a commit hash
while IFS= read -r line; do
  f=${line%%:*}; rest=${line#*:}
  if ! grep -qE '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})? ?(EDT|EST|UTC|Z|[+-][0-9]{4})' <<<"$rest" && ! grep -qE '\b[0-9a-f]{7,40}\b' <<<"$rest"; then
    say "FAIL time: unanchored clock time in $line"; fail=1
  fi
done < <(git ls-files '*.md' | xargs grep -nE '\b[0-2]?[0-9]:[0-5][0-9]\b' 2>/dev/null | grep -v '^.*:[0-9]*:.*```')

# 3) artifacts
if git ls-files | grep -qE '(\.pyc$|__pycache__/|\.pytest_cache/)'; then say "FAIL artifacts: build files are tracked"; fail=1; fi
[ -f .gitignore ] || { say "FAIL artifacts: no .gitignore"; fail=1; }

# 4) receipt freshness (receipt's listed files must hash to what it says)
for r in $(git ls-files '05-receipt/*.sha256'); do
  shasum -a 256 -c "$r" >/dev/null 2>&1 || { say "FAIL receipt: $r is stale — regenerate it LAST"; fail=1; }
done

[ $fail -eq 0 ] && say "verify-gate: OK ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
exit $fail
