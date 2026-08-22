#!/usr/bin/env bash
#
# One day's work, start to finish. Safe to run twice; safe to run after a gap.
#
#   npm run collect:daily              collect and rebuild
#   npm run collect:daily -- --upload  and push the page to the hosting
#
# The provider keeps roughly 40 days. Anything older than that is gone for good, so the
# point of running this regularly is not tidiness — it is the only way the dataset grows.
set -euo pipefail
cd "$(dirname "$0")/.."

UPLOAD=false
for arg in "$@"; do [ "$arg" = "--upload" ] && UPLOAD=true; done

# macOS date and GNU date disagree about relative dates.
if date -u -v-1d +%F >/dev/null 2>&1; then
  ago() { date -u -v-"$1"d +%F; }
else
  ago() { date -u -d "$1 days ago" +%F; }
fi

log() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

log "1/6  collecting the last three days again"
# Recent days are re-fetched even if already recorded: a trace can still be filling in,
# and a day written down as empty too early would stay empty for ever.
npx tsx src/cli/adsb-backfill.ts --all --from "$(ago 3)" --to "$(ago 1)" --concurrency 6 --force

log "2/6  filling any gap since the last run"
# Untouched days only; already-imported ones are skipped, so a long gap costs one pass.
npx tsx src/cli/adsb-backfill.ts --all --from "$(ago 39)" --to "$(ago 4)" --concurrency 6

log "3/6  rebuilding flights"
npx tsx src/cli/flights-rebuild.ts --all

log "4/6  missions and costs"
npx tsx src/cli/missions-rebuild.ts
npx tsx src/cli/costs-recompute.ts

log "5/6  re-applying hand-entered research"
# Purposes live in version control; this reattaches them to the rebuilt flights.
npx tsx src/cli/seed.ts

log "6/6  building the page"
npx tsx preview/export.ts
python3 preview/build.py

if [ "$UPLOAD" = true ]; then
  log "uploading"
  bash deploy/upload.sh
fi

log "done"
npx tsx src/cli/imports-list.ts | tail -20
