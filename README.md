# De Deepfake Detective Academie

A Dutch-first, English-enabled museum demo that teaches children and general
audiences how speech recognition and deepfake detection differ. Visitors move
through six short stations: sound-to-text, real-or-fake listening, compression,
sentence building, local voice cloning, and a practical safety quiz.

The demo takes about 12 minutes and runs on a laptop, tablet, or phone. During a
visit, microphone audio, model inference, and statistics are handled purely
locally on the host machine.

## Platform support

- Docker: macOS, Linux, and Windows with Docker Desktop or Docker Engine and
  Docker Compose v2.
- Native development: macOS, Linux, or Windows through WSL2.
- Live voice cloning: Apple Silicon through MPS, NVIDIA GPUs through CUDA on
  Linux or Windows, or CPU as a slower fallback.

## Local development

Install [Node.js 22](https://nodejs.org/en/download),
[Python 3.12](https://www.python.org/downloads/), and
[FFmpeg](https://ffmpeg.org/download.html). On Windows, run these commands in
WSL2. Then, from the repository root, run:

```bash
make dev
```

This installs dependencies, creates a synthetic development audio pack, and
starts the Next.js app at <http://localhost:3000>. The fixture contains tones and
silence; exhibition-quality media is generated separately. See
[tools/README.md](tools/README.md) for the media pipeline.

Live voice cloning is optional during development. Start its local model service
separately by following
[docs/LOCAL_VOICE_CLONING.md](docs/LOCAL_VOICE_CLONING.md); otherwise Station 5
shows an unavailable message and can be skipped.

## Checks

```bash
make check
```

This verifies the runtime and script syntax, runs the Python and web tests, lint,
typecheck, production build, sample-pack validation, and API end-to-end tests.

## Docker Compose

From a fresh clone, this starts the web demo:

```bash
git clone https://github.com/jmqcooper/deepfake-detective-demo.git
cd deepfake-detective-demo
docker compose up -d --build
```

Open <http://localhost:3000>. The container includes a synthetic audio fixture
when no exhibition pack is present and persists statistics in a named volume.
The first build needs internet access to download build dependencies; after it is
built, the application and all visit data stay local. Use
`docker compose logs -f web` for logs and `docker compose down` to stop it.

Yes, `docker compose up -d --build` automatically builds and starts the web demo
on macOS, Linux, and Windows. It deliberately does not put the large voice models
inside Docker, because doing so would hide Apple MPS and complicate host GPU
support. The web demo still works without them; to enable live cloning, run the
separate local service documented in
[docs/LOCAL_VOICE_CLONING.md](docs/LOCAL_VOICE_CLONING.md). That guide includes
one-time setup, virtual-environment activation, normal restart, and health-check
commands for macOS/Linux and Windows.

The resulting local layout is: browser → Docker web app → native voice service.
Docker reaches the service through `host.docker.internal`; no hosted inference
service is involved.

## Project layout

```text
web/src/app/           Next.js pages and API routes
web/src/components/    Kiosk shell and station interfaces
web/src/i18n/          Dutch and English copy
web/src/lib/           Shared contracts and tested logic
web/tests/             Unit and API tests
tools/                 Offline media pipeline and local model service
ops/                   Kiosk and maintenance scripts
SPEC.md                API, data, and manifest contracts
```

`web/public/samples/` is generated and gitignored. The research-media pipeline
is optional for development and described in [tools/README.md](tools/README.md).

## Licensing

- Code: Apache-2.0; see [LICENSE](LICENSE).
- Real speech: Common Voice (CC0), with Multilingual LibriSpeech (CC BY 4.0)
  available as a fallback source.
- Generated Voxtral TTS media: CC BY-NC 4.0.
- Voxtral ASR transcripts: Apache-2.0.
- Chatterbox Multilingual V3 voice cloning: MIT.
- DF Arena 500M clone detection: custom non-commercial licence.

See [NOTICE](NOTICE) for complete attribution and licence details.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow and required checks.
- [SPEC.md](SPEC.md) — application and media contracts.
- [tools/README.md](tools/README.md) — sample generation and validation.
- [Museum operations](docs/MUSEUM_OPERATIONS.md) — kiosk setup, recovery, and maintenance.
