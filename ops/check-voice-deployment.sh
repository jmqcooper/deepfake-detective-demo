#!/usr/bin/env bash
# End-to-end post-deployment check through the public web API. The internal
# bearer token deliberately stays inside the web container and model service.
set -eu

app_url="${APP_URL:-http://127.0.0.1:3000}"
ready_timeout="${VOICE_READY_TIMEOUT_SECONDS:-300}"
sample_wav="${VOICE_SAMPLE_WAV:-}"
sample_lang="${VOICE_SAMPLE_LANG:-nl}"

case "$ready_timeout" in
  ''|*[!0-9]*)
    echo "VOICE_READY_TIMEOUT_SECONDS must be a positive integer." >&2
    exit 2
    ;;
esac
if [ "$ready_timeout" -lt 1 ]; then
  echo "VOICE_READY_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi
if [ "$sample_lang" != "nl" ] && [ "$sample_lang" != "en" ]; then
  echo "VOICE_SAMPLE_LANG must be nl or en." >&2
  exit 2
fi

echo "Checking the web application at $app_url ..."
app_health="$(curl --fail --silent --show-error --max-time 10 "$app_url/api/health")"
case "$app_health" in
  *'"status":"ok"'*) ;;
  *)
    echo "The web health check is not healthy: $app_health" >&2
    exit 1
    ;;
esac

echo "Waking the native voice worker through the web container ..."
curl --fail --silent --show-error --max-time 35 \
  -X POST "$app_url/api/voice-clone/wake" >/dev/null

deadline=$((SECONDS + ready_timeout))
while [ "$SECONDS" -lt "$deadline" ]; do
  voice_health="$(
    curl --fail --silent --show-error --max-time 10 \
      "$app_url/api/voice-clone/health"
  )"
  case "$voice_health" in
    *'"ready":true'*)
      echo "Voice models are ready: $voice_health"
      break
      ;;
    *'"error":null'*) ;;
    *)
      echo "The voice worker reported a load error: $voice_health" >&2
      exit 1
      ;;
  esac
  sleep 2
done

case "${voice_health:-}" in
  *'"ready":true'*) ;;
  *)
    echo "Voice models did not become ready within ${ready_timeout}s." >&2
    exit 1
    ;;
esac

if [ -n "$sample_wav" ]; then
  if [ ! -f "$sample_wav" ]; then
    echo "VOICE_SAMPLE_WAV does not name a readable file: $sample_wav" >&2
    exit 2
  fi
  output_wav="$(mktemp "${TMPDIR:-/tmp}/deepfake-voice-check.XXXXXX.wav")"
  headers="$(mktemp "${TMPDIR:-/tmp}/deepfake-voice-check.XXXXXX.headers")"
  trap 'rm -f "$output_wav" "$headers"' EXIT HUP INT TERM

  echo "Running one real clone request ..."
  curl --fail --silent --show-error --max-time 320 \
    -D "$headers" \
    -F "lang=$sample_lang" \
    -F "audio=@$sample_wav;type=audio/wav" \
    -o "$output_wav" \
    "$app_url/api/voice-clone"
  if [ "$(LC_ALL=C head -c 4 "$output_wav")" != "RIFF" ]; then
    echo "The clone response was not a WAV file." >&2
    exit 1
  fi
  if ! grep -qi '^content-type: audio/wav' "$headers"; then
    echo "The clone response did not declare audio/wav." >&2
    exit 1
  fi
  echo "Real clone request passed. The temporary output was not retained."
fi

echo "PASS: web-to-worker authentication, connectivity, and model loading work."
