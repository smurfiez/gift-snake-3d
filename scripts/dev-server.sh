#!/usr/bin/env bash
# Dev server with auto-reload. Reuses a running instance, else takes the port.
port="${1:-9010}"
here="$(cd "$(dirname "$0")" && pwd)"

if curl -sf -o /dev/null "http://localhost:${port}/__reload/version"; then
  echo "reusing auto-reload server on port ${port}"
  exit 0
fi

if lsof -ti:"${port}" >/dev/null 2>&1; then
  # A plain http.server from an earlier run holds the port; take it back.
  lsof -ti:"${port}" | xargs kill 2>/dev/null
  sleep 0.5
fi

exec python3 "${here}/dev_server.py" "${port}"
