# ilcc-deepfake

A local Dutch/English interactive demo about speech recognition and fake voices.

## Choose what to install

| Part | What visitors get | Required |
|---|---|---|
| Web app | Stations 1–4 plus the safety finale, with the curated Dutch/English media pack | A container runtime; no Node, Python, FFmpeg, or media download |
| Voice-cloning add-on | Adds the record-and-clone station, for six stations total | Web app, internet for first download, microphone, and about 15 GB free space |

Install the web app first. Voice cloning is optional and has its own installer.

First, [download the project ZIP](https://github.com/jmqcooper/deepfake-detective-demo/archive/refs/heads/main.zip)
and extract it. Every command below is run from that extracted project folder.

> [!NOTE]
> If the voice service is not live on port `8765`, the app removes the cloning
> station automatically. Visitors go directly from Station 4 to the safety
> finale, and the progress bar shows five stations.[^voice-station]

## 1. Install the web app

The web installer builds an isolated container, starts it, waits for its health
check, and opens <http://localhost:3000>. Application packages are not installed
on the host. Anonymous statistics stay in a container volume between restarts.

The hand-selected Dutch and English real/fake voices are bundled under
`web/public/samples/`. The installer includes them unchanged; there is no
first-run media download. The optional voice-cloning models are the only large
media/model download and are handled separately in step 2. If a repackaged copy
of the repository omits the curated pack, the installer stops with a concrete
error instead of silently substituting test tones.

### macOS

Needed: [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/), running.

From the project folder, double-click `install/macos.command`. Or run:

```bash
./install/macos.command
```

If Docker Desktop is missing, the installer opens the official download page.
Install it, start it, and run `macos.command` again.

### Windows 10/11

Needed: [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/), running with its default Linux-container setting.

Double-click `install\windows.cmd`. The equivalent PowerShell command is:

```powershell
powershell -ExecutionPolicy Bypass -File .\install\windows.ps1
```

If Docker Desktop is missing, the installer opens the official download page.
Install it, start it, and run the command again. WSL commands are not required.

### Linux

Needed: either Docker Engine with the Compose plugin, or Podman with a Compose
provider. Start that service, then run from the project folder:

```bash
bash install/linux.sh
```

For installation of the one prerequisite, use the official
[Docker Engine](https://docs.docker.com/engine/install/) or
[Podman](https://podman.io/docs/installation) instructions for the exact Linux
distribution. The script detects either runtime automatically.

### Start, stop, and see logs

Use the same OS script with one of these actions:

| Action | macOS | Windows | Linux |
|---|---|---|---|
| Start/update | `./install/macos.command` | `.\install\windows.cmd` | `bash install/linux.sh` |
| Stop | `./install/macos.command stop` | `.\install\windows.cmd stop` | `bash install/linux.sh stop` |
| Logs | `./install/macos.command logs` | `.\install\windows.cmd logs` | `bash install/linux.sh logs` |

Stopping does not delete statistics. To remove the app and its stored statistics,
run `docker compose down -v` (or `podman compose down -v`). The `-v` deletion is
permanent.

## 2. Add voice cloning (optional)

The voice service runs natively so it can use Apple MPS or NVIDIA CUDA. Its
installer downloads a private Python 3.12 runtime and creates `.venv-voice/`.
Python packages and model caches stay inside this checkout under `.venv-voice/`
and `.runtime/`; shell profiles and system Python packages are not changed.

The supported device order is:

1. NVIDIA CUDA on Linux or Windows.
2. Apple MPS on Apple Silicon.
3. CPU fallback on any supported OS; one clone can take several minutes.

Keep the web app running, then start the matching voice installer.

### macOS voice add-on

```bash
./install/voice-macos.command
```

### Windows voice add-on

Double-click `install\voice-windows.cmd`, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install\voice-windows.ps1
```

### Linux voice add-on

```bash
bash install/voice-linux.sh
```

Keep that terminal window open. The first install downloads the Python and ML
packages. The launcher then downloads the pinned model weights on the first run
and starts loading both models immediately. Press `Ctrl+C` in the voice terminal
to stop it.

### Load and verify the models

There are two model processes inside the voice service: the voice cloner and
Echo's fake-voice detector. Starting the OS voice launcher begins loading both
automatically. Loading is asynchronous, so a running terminal does **not** yet
mean the models are ready.

The supported explicit load operation is `POST /api/voice-clone/wake` through
the web app. Station 4 sends this request automatically. It is safe to send it
again, and it is how models are reloaded after the ten-minute idle unload.

On macOS or Linux, this command checks the web app, sends the wake request, and
waits up to five minutes for both models:

```bash
ops/check-voice-deployment.sh
```

On Windows PowerShell, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\check-voice-deployment.ps1
```

A successful check ends with `PASS` and reports `device` as `mps`, `cuda`, or
`cpu`. You can inspect the current state at any time:

```bash
curl http://127.0.0.1:3000/api/voice-clone/health
```

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/voice-clone/health
```

Interpret the result exactly as follows:

| Result | Meaning | Action |
|---|---|---|
| `"ready": true` | Both models are loaded | Station 5 is ready |
| `"loading": true` | Download/load is still running | Keep the voice terminal open and wait |
| `"error": "..."` | Model loading failed | Read the error in the voice terminal |
| HTTP `503` | The voice service cannot be reached | Start the voice launcher and check port `8765` |

Readiness proves connectivity, authentication, model download, and model load.
For a complete microphone and inference test, open <http://localhost:3000>, walk
to the cloning station, record a voice, and confirm that a generated WAV plays.
On macOS/Linux, an existing 3–12 second WAV can test the same request directly:

```bash
VOICE_SAMPLE_WAV=/absolute/path/to/test.wav ops/check-voice-deployment.sh
```

The temporary generated test output is deleted. Reload the browser if the voice
service was started after the current visit began. When the service stops, the
web app detects that within ten seconds and removes the cloning station for the
next visitor.

The service uses port `8765`. The web container authenticates with the random
token created in the gitignored `.env` file. Do not expose port `8765` through a
router or public firewall.

For GPU overrides, on-demand Linux `systemd` operation, health commands, and a
real cloning deployment test, see
[Local voice cloning](docs/LOCAL_VOICE_CLONING.md).

## What is isolated

```text
Web app dependencies     container image
Visitor statistics       named container volume
Voice Python             .runtime/python/
Voice Python packages    .venv-voice/
Voice model cache        .runtime/huggingface/
Installer cache          .runtime/uv-cache/
Private shared token     .env (gitignored)
```

Deleting `.runtime/` and `.venv-voice/` removes the optional voice environment.
Do this only while the voice service is stopped; the folders can be recreated by
running the voice installer again.

## Developers and media builders

The installers above are for running the demo. Contributors who want native hot
reload can install Node.js 22, Python 3.12, and FFmpeg, then run:

```bash
make dev
```

This creates the normal local `.venv/`, installs web dependencies under
`web/node_modules/`, uses the bundled curated media pack, and opens the Next.js
development server at <http://localhost:3000>. Run all checks with:

```bash
make check
```

The synthetic tones-and-silence fixture remains available for pipeline and
container testing. See [Media pipeline](tools/README.md) to rebuild either pack.

## Project map

```text
install/                one-click OS launchers
web/src/app/            Next.js pages and API routes
web/src/components/     kiosk shell and station interfaces
web/src/i18n/           Dutch and English copy
web/src/lib/            shared contracts and tested logic
tools/                  media pipeline and native voice service
ops/                    demo deployment and maintenance
```

Operational documentation:

- [Local voice cloning](docs/LOCAL_VOICE_CLONING.md)
- [Demo operations](docs/DEMO_OPERATIONS.md)
- [Technical specification](SPEC.md)
- [Contributing](CONTRIBUTING.md)

Licences and model/media attribution are in [NOTICE](NOTICE). Repository code is
Apache-2.0; some generated media and model weights have additional or
non-commercial terms.

[^voice-station]: This is also enforced in
    `web/src/components/kiosk/DemoShell.tsx` and
    `web/src/lib/kiosk-flow.ts`: the browser polls the voice-service health
    endpoint, and an unavailable service makes the Station 4 transition skip the
    cloning station. The service being absent does not break the rest of the app.
