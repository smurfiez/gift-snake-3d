#!/usr/bin/env bash
# Open the game in a dedicated 9:16 Chrome app window (no browser chrome) for streaming.
# macOS caps the window height, so the viewport lands at 473x840 (9:16) on a 1512x982 display.
set -euo pipefail

PORT="${PORT:-9010}"
WIDTH="${WIDTH:-473}"
HEIGHT="${HEIGHT:-900}"
X="${X:-80}"
Y="${Y:-40}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://localhost:${PORT}/index.html?stream=1"
PROFILE="${HOME}/.gift-snake-stream-profile"

if ! nc -z localhost "$PORT" >/dev/null 2>&1; then
  (cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  for _ in $(seq 1 50); do
    nc -z localhost "$PORT" >/dev/null 2>&1 && break
    sleep 0.1
  done
fi

open -na "Google Chrome" --args \
  --app="$URL" \
  --user-data-dir="$PROFILE" \
  --window-size="${WIDTH},${HEIGHT}" \
  --window-position="${X},${Y}" \
  --no-first-run \
  --no-default-browser-check \
  --hide-crash-restore-bubble
