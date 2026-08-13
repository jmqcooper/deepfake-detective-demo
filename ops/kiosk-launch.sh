#!/usr/bin/env bash
set -euo pipefail

KIOSK_URL=${KIOSK_URL:-http://127.0.0.1:3000}
KIOSK_BROWSER=${KIOSK_BROWSER:-chromium}

if ! command -v "$KIOSK_BROWSER" >/dev/null 2>&1; then
  echo "error: kiosk browser '$KIOSK_BROWSER' is not installed" >&2
  exit 2
fi

for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 "$KIOSK_URL/api/health" >/dev/null; then
    break
  fi
  sleep 2
done
curl --fail --silent --show-error --max-time 2 "$KIOSK_URL/api/health" >/dev/null

if [ -n "${KIOSK_DISPLAY_OUTPUT:-}" ] && command -v xrandr >/dev/null 2>&1; then
  xrandr --output "$KIOSK_DISPLAY_OUTPUT" --rotate "${KIOSK_ROTATION:-normal}"
fi

exec "$KIOSK_BROWSER" \
  --kiosk \
  --incognito \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  "$KIOSK_URL"
