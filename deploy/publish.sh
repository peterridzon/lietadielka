#!/usr/bin/env bash
#
# Sets up the whole chain: GitHub for the code and the daily collector, Cloudflare Pages
# for the site.
#
#   gh auth login                  once
#   npx wrangler login             once
#   bash deploy/publish.sh [repo-name]
#
# Creating a public repository publishes everything in it — the observations, the
# registry, the research. That is the intent, but it cannot be undone quietly, so the
# script shows what will go out and waits for you to agree.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${1:-lietadielka}"
CF_PROJECT="${CF_PROJECT:-lietadielka}"

command -v gh >/dev/null || { echo "error: the GitHub CLI is not installed — https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: not logged into GitHub. Run: gh auth login"; exit 1; }

OWNER=$(gh api user --jq .login)

echo
echo "  repository   ${OWNER}/${REPO}  (public)"
echo "  hosting      Cloudflare Pages, project ${CF_PROJECT}"
echo "  commits      $(git rev-list --count HEAD)"
echo "  observations $(find data/observations -name '*.gz' 2>/dev/null | wc -l | tr -d ' ') day files, $(du -sh data/observations 2>/dev/null | cut -f1)"
echo "  aircraft     $(python3 -c "import json;d=json.load(open('data/aircraft.seed.json'));print(', '.join(a['registration'] for a in d['aircraft'] if a['trackingEnabled']))")"
echo

[ -z "$(git status --porcelain)" ] || { echo "error: uncommitted changes. Commit or stash them first."; git status --short; exit 1; }
if git ls-files | grep -qiE '(^|/)\.env$|\.pem$|\.key$'; then
  echo "error: credentials appear to be tracked by git. Remove them before publishing."; exit 1
fi

read -r -p "Publish this as a PUBLIC repository? [y/N] " reply
case "$reply" in [yY]*) ;; *) echo "Nothing done."; exit 0 ;; esac

echo
echo "▸ creating and pushing"
gh repo create "$REPO" --public --source=. --remote=origin --push \
  --description "Transparency platform for the use of Slovak state aircraft, built on public ADS-B data."

echo "▸ allowing the workflow to commit new observations"
gh api -X PUT "repos/${OWNER}/${REPO}/actions/permissions/workflow" \
  -f default_workflow_permissions=write -F can_approve_pull_request_reviews=false >/dev/null

# Cloudflare credentials. Without them the collector still runs and commits; only the
# publish step is skipped, so this can be filled in later.
echo
echo "▸ Cloudflare"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  gh secret set CLOUDFLARE_API_TOKEN --repo "${OWNER}/${REPO}" --body "$CLOUDFLARE_API_TOKEN"
  gh secret set CLOUDFLARE_ACCOUNT_ID --repo "${OWNER}/${REPO}" --body "$CLOUDFLARE_ACCOUNT_ID"
  gh variable set CF_PROJECT --repo "${OWNER}/${REPO}" --body "$CF_PROJECT" 2>/dev/null || true
  echo "  secrets set from the environment"
else
  echo "  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not in the environment."
  echo "  The collector will run without publishing. Add them later with:"
  echo "    gh secret set CLOUDFLARE_API_TOKEN --repo ${OWNER}/${REPO}"
  echo "    gh secret set CLOUDFLARE_ACCOUNT_ID --repo ${OWNER}/${REPO}"
fi

echo
echo "▸ running the collector once"
gh workflow run "Denný zber" --repo "${OWNER}/${REPO}" >/dev/null
sleep 5

echo
echo "Done. It collects again every morning at 04:17 UTC."
echo "  watch    gh run watch --repo ${OWNER}/${REPO}"
echo "  pages    https://${CF_PROJECT}.pages.dev/"
echo
echo "For lietadielka.com: Cloudflare dashboard, Workers & Pages, ${CF_PROJECT},"
echo "Custom domains, Set up a custom domain. The DNS record is created for you,"
echo "because the domain already uses Cloudflare nameservers."
