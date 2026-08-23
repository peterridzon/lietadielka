#!/usr/bin/env bash
#
# Publishes the project: creates the GitHub repository, pushes, turns on Pages, and runs
# the collector once so there is something to look at.
#
#   gh auth login          once, if you have not already
#   bash deploy/publish.sh [repo-name]
#
# Creating a public repository publishes everything in it — the observations, the
# registry, the research. That is the intent, but it cannot be undone quietly, so the
# script shows what will go out and waits for you to agree.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${1:-lietadielka}"

command -v gh >/dev/null || { echo "error: the GitHub CLI is not installed — https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: not logged in. Run: gh auth login"; exit 1; }

OWNER=$(gh api user --jq .login)

echo
echo "  repository   ${OWNER}/${REPO}  (public)"
echo "  page         https://${OWNER}.github.io/${REPO}/"
echo "  commits      $(git rev-list --count HEAD)"
echo "  observations $(find data/observations -name '*.gz' 2>/dev/null | wc -l | tr -d ' ') day files, $(du -sh data/observations 2>/dev/null | cut -f1)"
echo "  aircraft     $(python3 -c "import json;d=json.load(open('data/aircraft.seed.json'));print(', '.join(a['registration'] for a in d['aircraft'] if a['trackingEnabled']))")"
echo

if [ -n "$(git status --porcelain)" ]; then
  echo "error: the working tree has uncommitted changes. Commit or stash them first."
  git status --short
  exit 1
fi

# Anything that should never leave this machine would leave now.
if git ls-files | grep -qiE '(^|/)\.env$|\.pem$|\.key$'; then
  echo "error: credentials appear to be tracked by git. Remove them before publishing."
  exit 1
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

echo "▸ turning on Pages, built by Actions"
gh api -X POST "repos/${OWNER}/${REPO}/pages" -f 'build_type=workflow' >/dev/null 2>&1 \
  || gh api -X PUT "repos/${OWNER}/${REPO}/pages" -f 'build_type=workflow' >/dev/null

echo "▸ running the collector once"
gh workflow run "Denný zber" --repo "${OWNER}/${REPO}" >/dev/null
sleep 5

echo
echo "Done. It collects again every morning at 04:17 UTC."
echo "  run      gh run watch --repo ${OWNER}/${REPO}"
echo "  page     https://${OWNER}.github.io/${REPO}/    (live a minute or two after the first run)"
echo
echo "For a custom domain, add a CNAME at your registrar pointing to ${OWNER}.github.io,"
echo "then set it under Settings, Pages, Custom domain."
