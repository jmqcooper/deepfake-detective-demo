#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${E2E_PORT:-3100}
e2e_temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/nemo-e2e.XXXXXX")
LOG="$e2e_temp_dir/server.log"

cd "$ROOT/web"
STATS_DRIVER=memory npm run start -- -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -rf "$e2e_temp_dir"
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 40); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    E2E_BASE_URL="http://127.0.0.1:$PORT" npm run e2e
    exit 0
  fi
  sleep 0.25
done

echo "error: production server did not become healthy" >&2
tail -80 "$LOG" >&2
exit 1
