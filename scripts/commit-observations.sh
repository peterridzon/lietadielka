#!/usr/bin/env bash
#
# Commits a collection run and pushes it, safely against a concurrent run.
#
# The daily collection and the history backfill both write to main, and a run takes long
# enough that the other one — or a person — can land a commit in between. Rebasing then
# tries to merge preview/src/export.json and the built page, which are derived files with
# no meaningful merge: git writes conflict markers into generated output and the run dies
# having already spent an hour of streaming.
#
# Two rules follow, and the order matters.
#
# Observations are the irreducible state, they are append-only new files, and a day of
# archive streaming costs gigabytes. They are pushed first, on their own, before anything
# that could fail. Everything derived is discarded before the rebase and rebuilt from the
# merged result — simpler than merging and more correct, because the published page then
# describes every observation on the branch rather than only the ones this run fetched.
#
# The page is published only if the tests pass. Losing a rebuild is cheap; publishing a
# wrong number is not.
set -euo pipefail
cd "$(dirname "$0")/.."

MESSAGE="${1:-data: zber $(date -u +%F)}"

git config user.name 'lietadielka-collector'
git config user.email 'noreply@users.noreply.github.com'

npm run obs:export

# Derived files are rebuilt below; carrying local copies into the rebase is exactly what
# produced the conflicts this script exists to avoid.
git checkout -- preview/src/export.json preview/state-flights-preview.html public/index.html 2>/dev/null || true

if git status --porcelain -- data/observations | grep -q .; then
  git add data/observations
  git commit -m "$MESSAGE"
  echo '▸ zosúladenie so vzdialenou vetvou'
  git pull --rebase origin main
  git push origin main
  echo '✓ pozorovania sú v bezpečí na GitHube'
else
  echo 'Žiadne nové pozorovania.'
  git pull --rebase origin main
fi

# The rebase may have brought in observations from the other workflow, so rebuild from the
# full merged set rather than from what this run alone collected.
echo '▸ prepočet nad zlúčeným stavom'
npm run obs:import
npm run flights:rebuild -- --all
npm run missions:rebuild
npm run costs:recompute
npm run preview:build
mkdir -p public
cp preview/state-flights-preview.html public/index.html

npm test

git add preview/src/export.json preview/state-flights-preview.html public/index.html
if git diff --cached --quiet; then
  echo 'Stránka sa nezmenila.'
else
  git commit -m "build: prepočet a stránka $(date -u +%F)"
  git push origin main
  echo '✓ stránka publikovaná'
fi
