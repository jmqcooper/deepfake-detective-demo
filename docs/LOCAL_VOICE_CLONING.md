# Local live voice cloning

Live voice cloning works on the target MacBook Pro. It runs as a native local
service next to the web container so PyTorch can use Apple MPS. Participant audio
stays on that machine.

## Recommended model

The service uses **Chatterbox Multilingual V3** from Resemble AI. It supports
Dutch, accepts a short reference clip, includes an output watermark and uses an
MIT licence. The weights are cached during setup. Recordings are never sent to
Resemble AI or another inference provider.

Voxtral stays useful for the prepared sample pack. Its open model supports Dutch,
though the current vLLM-Omni voice-cloning path is still marked as gated upstream.
That makes it a poor dependency for the live station today.

## Participant flow

1. Show one short privacy line and ask the participant to continue.
2. Record 10 seconds while they read a fixed Dutch or English sentence.
3. Send the recording only to the same-host model service.
4. Generate one fixed, harmless sentence with stable local settings.
5. Play the clone, then let the local DF Arena 500M model make Echo's guess.
6. Delete the reference recording and generated clip when the station ends or the
   kiosk resets.

The live option appears only after a same-origin health check confirms both
models are ready. If the service is unavailable, the station explains this and
lets the participant continue.

## Privacy and abuse controls

- Keep reference audio in memory or a per-request temporary file.
- Delete every temporary file in a `finally` block.
- Disable request-body logging on the web proxy and model service.
- Accept only fixed exhibit sentences and a maximum recording length of 12 seconds.
- Return `Cache-Control: no-store` for generated audio.
- Bind the model service to `127.0.0.1`. The web proxy is its only caller.
- Clear object URLs in the browser on reset.

## Tested result on the MacBook Pro

- Apple M4 Pro, 24 GB unified memory, 20-core GPU
- 4.2-second Dutch reference recording
- warm single clone plus three detector checks: 12.9 seconds
- generated WAV: mono PCM16, 24 kHz
- Echo verdict: fake, high agreement
- voice-encoder similarity in the earlier model test: 0.922 cosine
- local Whisper recovered the full generated Dutch sentence, apart from reading
  the name Echo as Ego

## Speaker-similarity tuning

An A/B run on the same 8.06-second Dutch reference compared the upstream defaults
with the stable kiosk profile. The Chatterbox voice encoder scored the default at
0.8590 cosine similarity and the kiosk profile at 0.9207. The tuned request,
including Echo's detector checks, completed in 23.18 seconds on the M4 Pro.
The English profile uses seed 3407 and temperature 0.7. It scored 0.8915, up
from 0.8586 with the earlier profile. The service keeps separate fixed profiles
so a participant gets a stable result.

XTTS-v2 was also tested locally on the same references. It scored 0.8365 for
Dutch and 0.7253 for English. Its Coqui Public Model License is also more
restrictive than Chatterbox's MIT license, so it is not part of the station.

## Start the service

```bash
python3.12 -m venv .venv-voice
./.venv-voice/bin/pip install -r tools/voice-clone-requirements.txt
./.venv-voice/bin/python tools/voice_clone_service.py
curl http://127.0.0.1:8765/health
```

Wait until health reports `"ready": true`, then start the web app. The first
setup downloads model weights. Do that before opening the demo.
