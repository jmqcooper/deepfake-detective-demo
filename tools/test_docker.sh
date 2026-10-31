#!/usr/bin/env bash
set -euo pipefail

project="ilcc-deepfake-smoke-$$"
compose=(docker compose --project-name "$project")
url="${SMOKE_URL:-http://127.0.0.1:3000}"

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export FORCE_SYNTHETIC_SAMPLES=1
"${compose[@]}" up --detach --build --wait --wait-timeout 180

health="$(curl --fail --silent --show-error "$url/api/health")"
page="$(curl --fail --silent --show-error "$url/")"

grep -q '"status":"ok"' <<<"$health"
grep -q 'ilcc-deepfake' <<<"$page"

"${compose[@]}" exec -T web sh -c 'test -f .env.schema && test ! -e .env.infisical'
if "${compose[@]}" run --rm --no-deps -e STATS_DRIVER=postgres web >/dev/null 2>&1; then
  echo "error: the image started with an invalid STATS_DRIVER" >&2
  exit 1
fi

echo "Docker smoke test passed: container healthy, demo page reachable, bad env refused."
