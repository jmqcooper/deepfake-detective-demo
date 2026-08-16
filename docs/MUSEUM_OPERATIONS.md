# Museum operations runbook

This installation is offline-first. Station 5 records a visitor for ten seconds,
processes the audio on the exhibit computer, then deletes it. The only stored data is
anonymous interaction telemetry. Keep the sample pack, model cache and statistics
volume on the machine.

## Before opening

1. Start the native voice service with `./.venv-voice/bin/python -m tools.voice_clone_service` and wait for `curl --fail http://127.0.0.1:8765/health` to report `"ready":true`.
2. Start the app with `docker compose up -d --build`.
3. Wait for `docker compose ps` to report the web service as healthy, then check `curl --fail http://127.0.0.1:3000/api/health`.
4. Open the sound check and confirm both speakers are audible. Record and clone one test voice. Confirm microphone permission, playback and Echo's guess.
5. Walk all six stations in Dutch and English. Verify touch input, the skip control, audio replay, the final safety scenario, and the idle reset.
6. Back up statistics using the Docker commands below, and copy the resulting
   snapshot to encrypted museum storage.

Do not open the exhibition if health reports `media.status: "failed"`, the sound
check fails, the screen scrolls sideways, or a station cannot reset.

## Kiosk startup and recovery

`ops/nemo-kiosk.service` is a systemd template that waits for `/api/health` and relaunches Chromium after a crash. Copy the repository to `/opt/nemo-demo`, create the unprivileged `nemo` user, adjust `KIOSK_BROWSER`, `KIOSK_DISPLAY_OUTPUT`, and `KIOSK_ROTATION` if needed, then install and enable the unit:

```sh
sudo install -m 0644 ops/nemo-kiosk.service /etc/systemd/system/nemo-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable --now nemo-kiosk.service
```

For a frozen screen, first reload the kiosk. If health is failing, run `docker compose restart web` and inspect `docker compose logs --tail=200 web`. The SQLite database lives in the `stats-data` volume and online snapshots live in `stats-backups`; both survive container replacement.

## Statistics and privacy

The production database and backup directory are named Docker volumes. Use SQLite's online backup
API inside the running container, then copy the consistent snapshot out:

```sh
backup_path=$(docker compose exec -T web node ops/stats-maintenance.mjs backup | tr -d '\r')
docker cp "$(docker compose ps -q web):${backup_path}" ./
```

- Apply retention immediately: `docker compose exec -T web node ops/stats-maintenance.mjs prune`
- Reset between exhibition runs: `docker compose exec -T web node ops/stats-maintenance.mjs reset --yes`

For a non-Docker development database, use either
`DATABASE_PATH=web/data/stats.db node ops/stats-maintenance.mjs backup` or the
same command ending in `prune`.

Reset always creates a timestamped backup first. Store backups on encrypted museum storage, restrict operator access, and delete them under the same retention policy. The app must not log IP addresses, user agents, free text, audio, or stable visitor identifiers.
The cloning service accepts fixed exhibit sentences only and deletes its temporary WAV after each request.

## Release checklist

Use Node 22 and Python 3.12, then run `make check`. This provisions the locked Python environment, validates the native SQLite binding, runs the app tests/lint/typecheck/build, and decodes every media asset referenced by the manifest. Also run `docker compose build` on the target architecture. Keep the generated pack only when the release checker reports complete Dutch and English case pools, codec mirrors, non-empty delivered-audio transcripts, and a complete fake-factory grid.
