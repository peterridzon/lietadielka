#!/usr/bin/env bash
#
# Publishes the page to Cloudflare Pages by direct upload — no Git, no GitHub.
#
#   npx wrangler login          once
#   npm run deploy:cloudflare
#
# Hosting only. Nothing runs on Cloudflare: the page is a single static file. Keeping it
# up to date still means regenerating it, either by hand here or by a scheduled runner
# somewhere that can execute Node — which Workers cannot, given the archive is gigabytes
# a day.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${CF_PROJECT:-lietadielka}"

npm run preview:build

rm -rf .cf-out && mkdir -p .cf-out
cp preview/state-flights-preview.html .cf-out/index.html

echo
echo "  project  ${PROJECT}"
echo "  file     $(du -h .cf-out/index.html | cut -f1)"
echo

npx -y wrangler@latest pages deploy .cf-out --project-name "$PROJECT" --commit-dirty=true
rm -rf .cf-out

echo
echo "Done. Point a custom domain at it under Workers & Pages, your project, Custom domains."
