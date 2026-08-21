# Local live voice cloning

Station 5 uses a separate native service for Chatterbox Multilingual V3 and the
DF Arena detector. Inference stays on the exhibit computer and the temporary
reference recording is deleted after each request. The web app wakes this
service during Station 4 and polls readiness before enabling Station 5.

The service does not load models at process startup. A `POST /wake` request loads
them from the local Hugging Face cache (downloading pinned weights on the first
run). By default they are released after ten idle minutes. A systemd socket can
also start the worker on the first wake request and let it exit after the idle
timeout, returning all CPU RAM and GPU VRAM to the host.

## Supported hardware

The service chooses the fastest available PyTorch device automatically:

1. NVIDIA CUDA on Linux or Windows
2. Apple MPS on Apple Silicon
3. CPU on macOS, Linux, or Windows

CPU mode is functional but can take several minutes per clone. Apple MPS is the
tested exhibit configuration; CUDA support follows the device path supported by
Chatterbox and PyTorch. Set `VOICE_CLONE_DEVICE=cpu`, `cuda`, or `mps` to override
automatic selection. The service exits at startup when a requested accelerator
is unavailable instead of silently falling back.

## Set up once on macOS or Linux

```bash
python3.12 -m venv .venv-voice
source .venv-voice/bin/activate
python -m pip install -r tools/voice-clone-requirements.txt
deactivate
```

## Set up once on Windows

Run in PowerShell from the repository root:

```powershell
py -3.12 -m venv .venv-voice
.\.venv-voice\Scripts\Activate.ps1
python -m pip install -r tools\voice-clone-requirements.txt
deactivate
```

Activation is optional. If PowerShell blocks `Activate.ps1`, use
`.\.venv-voice\Scripts\python.exe` instead of `python` in the commands below.

For NVIDIA acceleration, install a CUDA-enabled PyTorch build compatible with
the pinned Chatterbox version and the installed NVIDIA driver. Confirm that
`torch.cuda.is_available()` returns `True`; otherwise the service uses CPU.

## Start it for local development

Start the small model service in one terminal:

```bash
source .venv-voice/bin/activate
python -m tools.voice_clone_service
```

On Windows PowerShell, activate it with
`.\.venv-voice\Scripts\Activate.ps1`, then run the same `python -m` command.
Start `make dev` in a second terminal. Both processes use
`http://127.0.0.1:8765` automatically.

Wake it, then wait for readiness:

```bash
curl --fail -X POST http://127.0.0.1:8765/wake
curl http://127.0.0.1:8765/health
```

The first wake downloads the pinned model weights. Wait until `/health` reports
`"ready": true`. Its `device` field shows `cuda`, `mps`, or `cpu`. Stop the
service with `Ctrl+C`; activate the environment and run the command again next
time.

## Start it beside Docker

Docker runs only the web app. The voice service runs natively beside it so it can
use the host GPU. In terminal 1 on macOS or Linux:

```bash
source .venv-voice/bin/activate
VOICE_CLONE_HOST=0.0.0.0 python -m tools.voice_clone_service
```

Terminal 1 on Windows PowerShell:

```powershell
.\.venv-voice\Scripts\Activate.ps1
$env:VOICE_CLONE_HOST = "0.0.0.0"
python -m tools.voice_clone_service
```

Then, in terminal 2:

```bash
docker compose up -d --build
```

Open <http://localhost:3000>. The Docker container connects to the native service
through `host.docker.internal`; no extra Compose service is required.

Binding to `0.0.0.0` can make port 8765 reachable from the local network. Keep
that port blocked by the host firewall; only the local Docker web container
needs it. Override `VOICE_CLONE_URL` in Compose if the service runs at another
local address.

## On-demand systemd worker on Linux

The included socket unit keeps no Python or model process running while idle.
The first internal connection to port 8765 starts the worker; after ten idle
minutes the worker exits and systemd leaves only the lightweight listening
socket behind.

The example units assume the repository is installed at `/opt/nemo-demo`, the
voice environment is `/opt/nemo-demo/.venv-voice`, and the unprivileged service
account is `nemo`. Adjust those three values in `ops/deepfake-voice.service` when
the server uses different paths or an account supplied by FEIOG.

```bash
sudo install -m 0644 ops/deepfake-voice.service /etc/systemd/system/
sudo install -m 0644 ops/deepfake-voice.socket /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now deepfake-voice.socket
curl --fail -X POST http://127.0.0.1:8765/wake
```

`VOICE_CLONE_DEVICE=auto` prefers NVIDIA CUDA, then Apple MPS, then CPU. On a
Linux VM with a CUDA GPU passed through, no application change is required.
Change `VOICE_CLONE_IDLE_SECONDS` to tune the warm period. Keep
`VOICE_CLONE_EXIT_ON_IDLE=1` for socket activation; a manually started service
can leave it unset and will unload the models while keeping its small API process
available.

## Participant flow

The visitor records ten seconds, approves the recording, and receives one fixed
generated sentence. The local detector then makes its own real-or-fake guess.
The option appears only when both models are ready; when the service is absent,
the station explains that it is unavailable and lets the visitor continue.

## Tested exhibit result

On an Apple M4 Pro with 24 GB unified memory, a warm Dutch clone plus three
detector checks took about 13 seconds. The generated file was mono PCM16 at
24 kHz. Other devices will vary, especially in CPU mode.
