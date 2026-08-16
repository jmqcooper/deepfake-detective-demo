# Local live voice cloning

Station 5 uses a separate native service for Chatterbox Multilingual V3 and the
DF Arena detector. Inference stays on the exhibit computer and the temporary
reference recording is deleted after each request.

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

## Install on macOS or Linux

```bash
python3.12 -m venv .venv-voice
./.venv-voice/bin/python -m pip install -r tools/voice-clone-requirements.txt
./.venv-voice/bin/python -m tools.voice_clone_service
```

## Install on Windows

Run in PowerShell from the repository root:

```powershell
py -3.12 -m venv .venv-voice
.\.venv-voice\Scripts\python.exe -m pip install -r tools\voice-clone-requirements.txt
.\.venv-voice\Scripts\python.exe -m tools.voice_clone_service
```

For NVIDIA acceleration, install a CUDA-enabled PyTorch build compatible with
the pinned Chatterbox version and the installed NVIDIA driver. Confirm that
`torch.cuda.is_available()` returns `True`; otherwise the service uses CPU.

The first start downloads the pinned model weights. Wait until
<http://127.0.0.1:8765/health> reports `"ready": true`. Its `device` field shows
`cuda`, `mps`, or `cpu`.

## Connect the web app

With `make dev`, the defaults work: both processes use
`http://127.0.0.1:8765`.

With the web app in Docker, the container connects through
`host.docker.internal`. Start the native service on an address Docker can reach:

```bash
VOICE_CLONE_HOST=0.0.0.0 ./.venv-voice/bin/python -m tools.voice_clone_service
docker compose up -d --build
```

PowerShell equivalent:

```powershell
$env:VOICE_CLONE_HOST = "0.0.0.0"
.\.venv-voice\Scripts\python.exe -m tools.voice_clone_service
docker compose up -d --build
```

Binding to `0.0.0.0` can make port 8765 reachable from the local network. Keep
that port blocked by the host firewall; only the local Docker web container
needs it. Override `VOICE_CLONE_URL` in Compose if the service runs at another
local address.

## Participant flow

The visitor records ten seconds, approves the recording, and receives one fixed
generated sentence. The local detector then makes its own real-or-fake guess.
The option appears only when both models are ready; when the service is absent,
the station explains that it is unavailable and lets the visitor continue.

## Tested exhibit result

On an Apple M4 Pro with 24 GB unified memory, a warm Dutch clone plus three
detector checks took about 13 seconds. The generated file was mono PCM16 at
24 kHz. Other devices will vary, especially in CPU mode.
