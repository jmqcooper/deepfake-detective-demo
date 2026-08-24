#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

RUNTIME_DIR="$ROOT_DIR/.runtime"
UV_BIN="$RUNTIME_DIR/bin/uv"
VOICE_PYTHON="$ROOT_DIR/.venv-voice/bin/python"
UV_VERSION=0.12.5

export UV_CACHE_DIR="$RUNTIME_DIR/uv-cache"
export UV_PYTHON_INSTALL_DIR="$RUNTIME_DIR/python"
export UV_PYTHON_BIN_DIR="$RUNTIME_DIR/python-bin"
export UV_NO_MODIFY_PATH=1
export HF_HOME="$RUNTIME_DIR/huggingface"
export TORCH_HOME="$RUNTIME_DIR/torch"
export XDG_CACHE_HOME="$RUNTIME_DIR/cache"

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  if [ "$(uname -s)" = "Darwin" ] && [ -t 0 ]; then
    printf 'Press Return to close this window. '
    read -r _answer
  fi
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required to download the isolated Python runner."

if [ ! -x "$UV_BIN" ]; then
  printf '\nDownloading the isolated Python runner...\n'
  mkdir -p "$RUNTIME_DIR/bin"
  uv_installer="$RUNTIME_DIR/uv-install.sh"
  curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" -o "$uv_installer"
  env UV_UNMANAGED_INSTALL="$RUNTIME_DIR/bin" UV_NO_MODIFY_PATH=1 sh "$uv_installer"
  rm -f "$uv_installer"
fi

printf '\nCreating the private Python 3.12 voice environment...\n'
"$UV_BIN" python install 3.12
if [ ! -x "$VOICE_PYTHON" ]; then
  "$UV_BIN" venv --python 3.12 --managed-python "$ROOT_DIR/.venv-voice"
fi
"$UV_BIN" pip sync --python "$VOICE_PYTHON" tools/voice-clone-requirements.txt

[ -f .env ] || fail "The web app has not been installed yet. Run its OS installer first; it creates the shared private token."
VOICE_CLONE_TOKEN=$(sed -n 's/^VOICE_CLONE_TOKEN=//p' .env | tail -n 1)
[ -n "$VOICE_CLONE_TOKEN" ] || fail "VOICE_CLONE_TOKEN is empty in .env. Run the web app installer once to create it."
export VOICE_CLONE_TOKEN
export VOICE_CLONE_HOST=0.0.0.0

printf '\nVoice cloning is starting on http://127.0.0.1:8765\n'
printf 'Keep this window open. The first visit to Station 4 downloads and warms the models.\n'
printf 'Press Ctrl+C to stop voice cloning.\n\n'
exec "$VOICE_PYTHON" -m tools.voice_clone_service
