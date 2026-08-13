#!/usr/bin/env bash
set -euo pipefail

project="deepfake-detective-smoke-$$"
compose=(docker compose --project-name "$project")

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export FORCE_SYNTHETIC_SAMPLES=1
"${compose[@]}" up --detach --build --wait --wait-timeout 180

health="$(curl --fail --silent --show-error http://127.0.0.1:3000/api/health)"
page="$(curl --fail --silent --show-error http://127.0.0.1:3000/)"

grep -q '"status":"ok"' <<<"$health"
grep -q 'Deepfake Detective' <<<"$page"

echo "Docker smoke test passed: container healthy and demo page reachable."
