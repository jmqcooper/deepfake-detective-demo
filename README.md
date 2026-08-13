# De Deepfake Detective Academie

An interactive, museum-ready web demo that teaches an 8-year-old — and a general
audience — how speech AI works and how deepfake voices get caught. Built for the
**INDEEP** project (UvA), intended for NEMO and similar venues. Dutch-first, with
an English toggle. Runs on a laptop, tablet or phone.

Two AI personas carry the story, and the distinction between them *is* the lesson:
**Miko** (a soft amber circle) is the speech recogniser — eager, writes down every
word, believes all of them. **Agent Echo** (a hard teal shield) is the detective —
suspicious, reads spectrograms, catches the fakes. The punchline, landed through
play in Station 4: Miko transcribes a deepfake perfectly and never notices it is
fake. Recognising speech and detecting forgery are different jobs; you need both.

The five stations (~10 min): **1** how sound becomes text, **2** Echt of Nep? —
guess a clip real or fake, **3** the compression machine, **4** the nepstem-fabriek,
**5** Detective Diploma.

## Quick start (local development)

The whole runtime is one **Next.js 16** app in `web/`. It needs **no GPU and no
models** — it serves pre-generated audio plus one tiny stats API. For development
without Docker, install [Node.js 22](https://nodejs.org/en/download),
[Python 3.12](https://www.python.org/downloads/), and
[FFmpeg/ffprobe](https://ffmpeg.org/download.html) with libmp3lame support.

```bash
make dev
```

On a fresh clone this installs dependencies, generates the local development
fixture (`web/public/samples/` is generated and gitignored, so without a pack
the app only shows a friendly "run the sample pipeline" screen), and starts the
dev server at <http://localhost:3000>.

> The fixture is **tones and silence**, not real speech — enough to boot and develop
> the whole app, but not exhibit- or research-quality audio. See
> [tools/README.md](tools/README.md) for the real-media pipeline and the individual
> commands `make dev` runs.

## Checks

```bash
make check
```

Provisions the locked Python environment, enforces Node 22/native SQLite parity, runs unit
tests, lint, typecheck and the production build, then decodes and validates the complete
sample pack. See
[tools/README.md](tools/README.md) for the individual commands.

## Run with Docker (recommended)

If an IT or hosting team will run the demo, ask them to **deploy this application
as a Linux Docker container** (or as the included Docker Compose service). The
runtime is CPU-only, listens on port `3000`, needs no model server or GPU, and
stores its anonymous statistics in `/app/data`. Put the service behind the
organisation's usual HTTPS reverse proxy when it is exposed beyond a trusted
local network.

### Prerequisites

- [Git](https://git-scm.com/downloads) to clone the repository.
- [Docker Desktop](https://docs.docker.com/desktop/) on macOS or Windows, or
  [Docker Engine](https://docs.docker.com/engine/install/) on a Linux host.
- [Docker Compose v2](https://docs.docker.com/compose/install/) (included with
  Docker Desktop; install the Compose plugin with Docker Engine).

Node.js is **not** required on the host for this route: the Docker image builds
and contains the Node.js application and generates a synthetic demo audio pack
when no exhibition pack is present. Python, FFmpeg, and `make` are also contained
in or unnecessary for the Docker build. The host only needs Docker, port `3000`,
and (when statistics must survive restarts) a persistent volume at `/app/data`.

### Start the demo

```bash
git clone https://github.com/jmqcooper/deepfake-detective-demo.git
cd deepfake-detective-demo
docker compose up -d --build
```

Open <http://localhost:3000>. Check the deployment with `docker compose ps` and
view logs with `docker compose logs -f web`. Stop it with `docker compose down`;
the named statistics volume is retained.

On a fresh clone, the image build creates a small synthetic audio fixture so the
complete teaching flow works immediately. If `web/public/samples/manifest.json`
already exists, that exhibition pack is included instead. The root build context
is allow-listed, so local model caches, virtualenvs and databases never reach
Docker. SQLite
persists to a named volume and the container exposes a `/api/health` health
check. For ephemeral counters set `STATS_DRIVER=memory`; to disable reporting
entirely set `STATS_DRIVER=none`, which reports degraded health without stopping
the teaching flow.

## Research-media regeneration (optional)

The samples above are a synthetic fixture. Exhibition- and research-quality media —
real Common Voice speech, separately generated Voxtral TTS fakes, and genuine Voxtral
ASR transcripts — come from an **offline, provider-neutral pipeline** described by its
input/output contract and licensing constraints in **[tools/README.md](tools/README.md)**.
That pipeline is not required to develop or run the app.

## Architecture

```
web/src/app/           # Next.js pages + API routes (events, stats, health)
web/src/components/    # DemoShell + kiosk chrome + stations/ (the five station UIs)
web/src/i18n/          # nl.json / en.json — ALL user-visible copy lives here
web/src/lib/           # the contracts and the logic: manifest schema, event
                       # handling, stats, kiosk flow, audio state, i18n rules
web/tests/             # node --test, no test framework to install
web/public/samples/    # GENERATED, gitignored — the sample pack + manifest.json
tools/                 # offline media pipeline (Python)
SPEC.md                # API, data and manifest contracts — the source of truth
docker-compose.yml     # deployment
```

`web/src/lib/` is React-free on purpose. Anything that has to be *correct* rather
than merely rendered — whether a guess was right, which clip a session has already
answered, when the kiosk resets — lives there and is covered by `npm test`. The
stations stay thin.

## Honesty

The demo is about deception, so it does not practise any. Spectrogram tells are
presented as clues about the clips in the pack, never as a test that works on the
next voice message: modern fakes add breath and room noise, and plenty of genuine
recordings sound spotless. Agent Echo is theatre with a script, and says so —
the pack ships with prepared labels because we generated the fakes ourselves, and
nothing on screen analyses audio. Every transcript is the recogniser's real output,
mistakes included.

Which is why the demo ends on a scenario rather than a score: a voice you know asks
for money, and the answer is to hang up and call back on a number you already have.
That works even when your ears have been fooled — and after four stations, a visitor
knows they can be.

## Privacy

No microphone access, no audio upload, no personal data, no cookies. The only stored
data is an anonymous per-clip counter plus a session score, so the demo can say "71%
of visitors were fooled by this one". Session IDs are random, in-memory, and never
correlated across visits; a reset forgets the id on the server as well as in the
browser. Event retention defaults to 90 days and can be changed with
`STATS_RETENTION_DAYS`.

The rate limiter respects this too: it is keyed on the anonymous session id the
request already carries, never on a client address — hashed or otherwise. No IP is
read, logged or stored anywhere in the app.

## Licensing

- **Code:** Apache-2.0 — see [LICENSE](LICENSE).
- **Real speech:** Common Voice (CC0) for the current v2 case packs; Multilingual
  LibriSpeech (Dutch), CC BY 4.0 (attribution required), for the fallback inputs.
- **Deepfake speech:** generated by `mistralai/Voxtral-4B-TTS-2603`, whose weights are
  **CC BY-NC 4.0 (non-commercial)** — the one component that is not fully open. Commercial
  use requires removing, replacing, or separately licensing it; verify the licence covers
  your intended use before publishing. Do not describe the whole sample pack as permissively
  licensed.
- **ASR transcripts:** `mistralai/Voxtral-Mini-4B-Realtime-2602`, Apache-2.0.

See [NOTICE](NOTICE) for the full attribution notice.

## More

- [CONTRIBUTING.md](CONTRIBUTING.md) — first-contribution loop and where changes belong.
- [tools/README.md](tools/README.md) — the offline media pipeline.
- [SPEC.md](SPEC.md) — API, data and manifest contracts.
- [NOTICE](NOTICE) — attribution and licensing notice.
- [Museum operations](docs/MUSEUM_OPERATIONS.md) — opening checks, kiosk recovery, backups, retention and reset.
