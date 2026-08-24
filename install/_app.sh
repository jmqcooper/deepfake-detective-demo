#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

pause_on_macos() {
  if [ "$(uname -s)" = "Darwin" ] && [ -t 0 ]; then
    printf '\nPress Return to close this window. '
    read -r _answer
  fi
}

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  pause_on_macos
  exit 1
}

compose() {
  if [ "$CONTAINER_RUNTIME" = "docker" ]; then
    docker compose "$@"
  else
    podman compose "$@"
  fi
}

ensure_private_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
  fi

  current_token=$(sed -n 's/^VOICE_CLONE_TOKEN=//p' .env | tail -n 1)
  if [ -n "$current_token" ]; then
    return
  fi

  if command -v openssl >/dev/null 2>&1; then
    new_token=$(openssl rand -hex 32)
  elif [ -r /dev/urandom ]; then
    new_token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  else
    fail "Could not create the private web-to-voice token. Install OpenSSL and run this file again."
  fi

  temporary_env=".env.tmp.$$"
  awk -v token="$new_token" '
    BEGIN { replaced = 0 }
    /^VOICE_CLONE_TOKEN=/ { print "VOICE_CLONE_TOKEN=" token; replaced = 1; next }
    { print }
    END { if (!replaced) print "VOICE_CLONE_TOKEN=" token }
  ' .env > "$temporary_env"
  mv "$temporary_env" .env
  chmod 600 .env 2>/dev/null || true
}

ACTION=${1:-start}

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  CONTAINER_RUNTIME=docker
  docker info >/dev/null 2>&1 || fail "Docker Desktop is installed but not running. Start it, wait for it to say it is ready, then run this file again."
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
  CONTAINER_RUNTIME=podman
  podman info >/dev/null 2>&1 || fail "Podman is installed but not running. Start its machine/service, then run this file again."
else
  if [ "$(uname -s)" = "Darwin" ]; then
    command -v open >/dev/null 2>&1 && open "https://docs.docker.com/desktop/setup/install/mac-install/" || true
    fail "Install and start Docker Desktop from the page that just opened, then double-click install/macos.command again."
  fi
  fail "Install Docker Engine with the Compose plugin (or Podman with a Compose provider), then run: bash install/linux.sh"
fi

case "$ACTION" in
  start|install)
    ensure_private_env
    printf '\nBuilding and starting the Deepfake Detective web app...\n'
    compose up -d --build

    printf 'Waiting for http://localhost:3000 ...\n'
    attempt=0
    while [ "$attempt" -lt 90 ]; do
      healthy=false
      if command -v curl >/dev/null 2>&1; then
        if curl --silent --fail --max-time 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
          healthy=true
        fi
      else
        if compose exec -T web node -e \
          "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
          >/dev/null 2>&1; then
          healthy=true
        fi
      fi
      if [ "$healthy" = true ]; then
        printf '\nReady: http://localhost:3000\n'
        if [ "$(uname -s)" = "Darwin" ]; then
          open http://localhost:3000
        elif command -v xdg-open >/dev/null 2>&1; then
          xdg-open http://localhost:3000 >/dev/null 2>&1 || true
        fi
        exit 0
      fi
      attempt=$((attempt + 1))
      sleep 2
    done

    compose logs --tail=80 web || true
    fail "The app did not become healthy within three minutes. The last web logs are shown above."
    ;;
  stop)
    compose down
    printf 'Stopped. Saved statistics were kept.\n'
    ;;
  logs)
    compose logs --tail=200 web
    ;;
  *)
    fail "Unknown action '$ACTION'. Use start, stop, or logs."
    ;;
esac
