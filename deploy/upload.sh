#!/usr/bin/env bash
# Uploads the built preview to WebSupport over SFTP.
#
# Credentials come from the environment and are never written anywhere:
#   WS_HOST   server hostname from Webadmin
#   WS_USER   hosting login
#   WS_PATH   absolute path to the web root, e.g. /login/web
#   WS_FILE   optional: what to upload (default: the built preview)
#   WS_NAME   optional: name on the server (default: index.html)
set -euo pipefail

FILE="${WS_FILE:-preview/state-flights-preview.html}"
NAME="${WS_NAME:-index.html}"

for var in WS_HOST WS_USER WS_PATH; do
  if [ -z "${!var:-}" ]; then
    echo "error: $var is not set. See deploy/README.md." >&2
    exit 1
  fi
done

if [ ! -f "$FILE" ]; then
  echo "error: $FILE does not exist. Run 'npm run preview:build' first." >&2
  exit 1
fi

SIZE=$(du -k "$FILE" | cut -f1)
echo "uploading $FILE (${SIZE} KB) → ${WS_USER}@${WS_HOST}:${WS_PATH}/${NAME}"

# scp over the hosting's SSH access. An FTP client works just as well if SSH is not
# enabled on the plan — the file is a single self-contained page either way.
scp "$FILE" "${WS_USER}@${WS_HOST}:${WS_PATH}/${NAME}"

echo "done. The page is a single self-contained file: no database, no PHP, nothing to configure."
