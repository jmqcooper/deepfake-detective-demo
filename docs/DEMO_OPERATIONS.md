# Demo operations

Installation, startup, voice-model loading, and readiness checks are documented
in the root [README](../README.md). This page only covers ongoing kiosk recovery,
statistics, privacy, and release checks.

## Routine check

1. Confirm `curl --fail http://127.0.0.1:3000/api/health` succeeds.
2. When voice cloning is enabled, run `ops/check-voice-deployment.sh` on
   macOS/Linux or `ops/check-voice-deployment.ps1` on Windows.
3. Confirm both speakers, microphone permission, audio replay, the skip control,
   the final safety scenario, and idle reset.
4. Walk the complete route in Dutch and English: six stations with voice
   cloning, five without.

Do not use the demo if health reports `media.status: "failed"`, the sound check
fails, the screen scrolls sideways, or a station cannot reset.

## Kiosk recovery

`ops/ilcc-deepfake-kiosk.service` waits for `/api/health` and relaunches Chromium
after a crash. The template assumes the repository is at `/opt/ilcc-deepfake`
and runs as the unprivileged `ilcc-deepfake` account. Adjust `KIOSK_BROWSER`,
`KIOSK_DISPLAY_OUTPUT`, and `KIOSK_ROTATION` when needed.

```sh
sudo install -m 0644 ops/ilcc-deepfake-kiosk.service \
  /etc/systemd/system/ilcc-deepfake-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable --now ilcc-deepfake-kiosk.service
```

For a frozen screen, reload the kiosk first. If application health is failing,
run `docker compose restart web` and inspect
`docker compose logs --tail=200 web`. The `stats-data` and `stats-backups`
volumes survive container replacement.

## Statistics and privacy

Create a consistent SQLite snapshot, then copy it out of the container:

```sh
backup_path=$(docker compose exec -T web node ops/stats-maintenance.mjs backup | tr -d '\r')
docker cp "$(docker compose ps -q web):${backup_path}" ./
```

- Apply retention: `docker compose exec -T web node ops/stats-maintenance.mjs prune`
- Reset between demo runs: `docker compose exec -T web node ops/stats-maintenance.mjs reset --yes`

Reset creates a timestamped backup first. Store backups in approved encrypted
storage, restrict operator access, and apply the same retention policy. The app
must not log IP addresses, user agents, free text, audio, or stable visitor
identifiers. The voice service accepts fixed sentences only and deletes its
temporary WAV after each request.

## Release check

Run `make check`, `make release-check`, and `docker compose build` on the target
architecture. The release check must report complete Dutch and English case
pools, codec mirrors, delivered-audio transcripts, and a complete fake-factory
grid.
