#!/usr/bin/env bash
# Run the blind independent tests against a clone of elghaied/payload-reserve @ b04d04b:
#   copy blind.int.spec.ts to <clone>/dev/trenyx-verify/, install (Node 22, pnpm 9), then
#   pnpm vitest run dev/trenyx-verify/blind.int.spec.ts --project integration --reporter=verbose
# Remove dev/trenyx-verify/ before running the planted-defect matrix (their suite must run alone).
set -euo pipefail
CLONE=${1:?path to target clone at b04d04b}
mkdir -p "$CLONE/dev/trenyx-verify" && cp "$(dirname "$0")/blind.int.spec.ts" "$CLONE/dev/trenyx-verify/"
cd "$CLONE" && pnpm vitest run dev/trenyx-verify/blind.int.spec.ts --project integration --reporter=verbose
