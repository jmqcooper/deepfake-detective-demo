# Deepfake Education Web Demo Project
Created: 7/7/2026, 11:24:25 AM
Last Updated: 7/7/2026, 11:41:27 AM
---

### User

A project that I need to make for my university as a paid student. This project is supposed to be a web-based interactive demo that will be able to be showcased at NAMO or other museums that have an age group of, let's say, eight-year-olds and older. A child should be able to understand it and really get an intuitive feeling for how AI and deepfakes work and how the AI gets found. For example in one of the exam samples, of it being real or fake, they were thinking of perhaps using it, kind of like a police agent, to figure it out. Give some suggestions on how you would frame it and give multiple different suggestions on the design. 


Now I would like you to read the entire thread to have a look at how you would set this up. I want to use the Mistral open source model that has recently been released. I think it does Dutch and English and also does accents very well and it's open source so we can run it ourselves. Have a look at how we could run this in the easiest way, preferably with the least amount of clicks and with a small setup, like SQLite or whatever if we need anything database-related. Also do a separate version that would allow me to host it on my personal site on Next.js. 

the email content:
Hoi allen,

Helemaal prima als Mike volgende week al zou kunnen beginnen: Tom heeft tijd om te begeleiden in de maand Juli, en ik ben weer terug vanaf 12 Aug dus dat zou moeten lukken.

@Rudmer/Jelle, het contract regelen en tekenen ligt natuurlijk bij jullie op de UvA.

Tom en ik hebben vandaar besproken wat de eerste stappen zijn en hier is onze lijst, alle suggesties welkom!


Voorkeur voor Demo opzet

Demo krijgt de vorm van een web-applicatie of app: op die manier kunnen we hem overal gebruiken zonder dedicated laptop te moeten inrichten.

 

 

Praktische voorwaarden:

 

-       Open source software gebruiken

-       Draaien op webserver hosted door Universiteit of in ieder geval europa.

-       Ontwikkelde code is ook open source zijn

-       Software moet documentatie hebben en eenvoudig te gebruiken binnen het Indeep project zodat we demos kunnen geven

-       Doelgroep is niet perse alleen kinderen, maar een ook breed algemeen publiek

 

 

Eerste stappen om uit te zoeken:

-       Heeft de UvA een server waar een web applicatie kan draaien?  En kan/heeft Mike daar toegang krijgen (@Mike/Jelle/Rudmer)

-       Wat is er nodig voor spraakmodel?

-       Wat zijn randvoorwaarden  -zou de demo werken op een laptop of tablet of  telefoon: interface design?

-       Bij web-applicatie of app: welke platformen minimaal om op te draaien? Veel van ons werken bijv met Macs



 

 Server backplan: kan eventueel draaien bij de RU of TiU – in zomervakantie wel minder bereikbare IT afdeling

 

 

Ontwerp van de demo: we zijn enthousiast met Mikes idee van ‘soort web-app met "stations" en we denken dat het goed is om te beginnen met de eerste drie hiervan om te zien hoe veel tijd dat kost voordat we de meer uitdagende ’stations’ invullen.

We zouden een Nederlandstalige en eventueel ook een Engelstalige versie kunnen maken:

 

 

1.     In het brein van de spraak-AI — Simpele visualisatie van hoe het netwerk
audio analyseert 

2.     Echt of Nep? — Audiofragmenten afspelen, raden, en dan via
spectrogrammen het verschil laten zien

3.     Wat doet compressie? — Slider waarmee je hoort en ziet hoe audio
verandert door compressie (WhatsApp, bellen, etc.)

 

Maak in demo ontwerp duidelijk dat er 2 AI systemen zijn, Toms idee was om die bijvoorbeeld personas te geven zoals een ‘minion’ (ASR - Whisper) en een ‘politieagent’ die op de deepfakes checkt.

 

Het plan ‘neem je eigen stem op’ om een deepfake te maken is leuk maar hiervoor moeten we naar ethische commissie dus dat zou pas na zomer haalbaar zijn.

Het is ook zo dat je deze eerste drie kunt bouwen met pre-processed samples: dus zonder microfoon toegang voor live audio-opnames en runnen ASR -wat het leuker maar ook veel lastiger maakt.

@Mike we hebbben een andere demo – deze moet wel steeds op een dedicated laptop worden gezet maar je kunt eens kijken naar de modellen die we daar gebruiken: https://github.com/timjzee/indeep-demonstrator

 

@Mike, Tom en ik zouden ook graag je scriptie lezen als tie klaar is!

 

@Tom en Mike, ik zou maandag ergens tussen 12 en 14 even kunnen overleggen, of donderdag tussen 12-1330?

Groetjes


---

### Assistant (claude-fable-5)

<details>
<summary>Reasoning</summary>

I'm trying to pin down which Mistral open-source voice model the user is referring to — likely Voxtral, their speech recognition system released in July 2025, though they might be asking about something even newer since we're now in July 2026. The mention of accents and Dutch suggests they're interested in multilingual capabilities, and I should search for the latest Mistral voice releases to give them accurate information.
</details>

<details>
<summary>Reasoning</summary>

I'm outlining two deployment approaches: one for the UvA/EU server using Docker Compose to orchestrate vLLM, FastAPI, SQLite, and a static frontend together, and another for a personal Next.js site that either pre-processes data or makes API calls to a hosted vLLM instance or Mistral API.
</details>

Great news: the model you're thinking of exists in two flavors, and you'll likely want **both**:

- **Voxtral Mini 4B Realtime (2602)** — Apache 2.0, realtime multilingual ASR (Dutch + English, <500 ms delay), runs on a single 16 GB GPU. This is your "minion" (transcription) persona — a drop-in upgrade over Whisper from the indeep-demonstrator repo.
- **Voxtral TTS 4B (2603)** — open weights (CC BY-NC 4.0, fine for a non-commercial university demo), 9 languages incl. Dutch, voice cloning from 3s, also ~16 GB GPU. This is what generates your "fake" samples with accents.

Both are served via **vLLM (≥ 0.18, vLLM-Omni for TTS)** with official Docker images — that's the fewest-clicks path.

## Version A: Self-hosted (UvA/EU server) — recommended

Architecture: one `docker compose up` and done.

```text
[Browser: static frontend, spectrograms via Web Audio API]
        │
[FastAPI backend + SQLite (guess stats, sample metadata)]
        │
[vLLM container: Voxtral Mini Realtime (ASR)]
[vLLM container: Voxtral TTS (only needed offline to pre-generate fakes)]
```

```yaml
# docker-compose.yml
services:
  asr:
    image: vllm/vllm-openai:latest
    command: >
      mistralai/Voxtral-Mini-4B-Realtime-2602
      --tokenizer_mode mistral --config_format mistral --load_format mistral
    deploy:
      resources:
        reservations:
          devices: [{ driver: nvidia, count: 1, capabilities: [gpu] }]
    volumes:
      - hf-cache:/root/.cache/huggingface
    environment:
      - HUGGING_FACE_HUB_TOKEN=${HF_TOKEN}

  app:
    build: ./app # FastAPI + static files
    ports: ["80:8000"]
    volumes:
      - ./data:/data # SQLite lives here
    environment:
      - ASR_URL=http://asr:8000/v1

volumes:
  hf-cache:
```

Key decisions that keep it small:

1. **Pre-generate the deepfakes offline.** Per the email, stations 1–3 don't need live audio. Run Voxtral TTS once on your own machine/a rented GPU, save WAV files + pre-computed spectrogram PNGs (or JSON mel data) into `/data/samples/`. Then the museum server doesn't even need the TTS container running — only ASR if you want the live "in het brein" visualization.
2. **SQLite via one file** (`sqlite3` in Python stdlib or SQLModel). Store: sample metadata (real/fake, language), aggregate guess counts ("73% of visitors were fooled by this clip!" — great museum hook), and nothing personal (GDPR-friendly, no ethics committee needed).
3. **Frontend = plain static site or small React app** served by FastAPI. Spectrograms of pre-processed clips can be pre-rendered images; the compression-slider station can be done fully client-side with the Web Audio API (no backend at all).
4. If the UvA server has **no GPU**: everything still works because stations 1–3 are pre-processed. Add live ASR later, or run Voxtral Mini via ExecuTorch/CPU for demos on a laptop.

## Version B: Next.js on your personal site

Since Vercel/typical hosting has no GPU, split it:

- **Fully static variant (zero infra):** pre-generate all audio + spectrogram data as static assets in `/public/samples/`. All three stations work client-side. Guess stats via SQLite is replaced by:
  - **Turso** (SQLite-compatible, EU region, free tier) or Vercel Postgres, accessed from a Next.js Route Handler (`app/api/guess/route.ts`) with `@libsql/client`. One table, two endpoints (`POST /api/guess`, `GET /api/stats`).
- **Live-ASR variant:** keep the vLLM ASR container running on any EU GPU box (UvA server, or a €0.30/hr spot GPU on e.g. Scaleway/OVH to stay in Europe), and have your Next.js route handler proxy to its OpenAI-compatible endpoint:

```ts
// app/api/transcribe/route.ts
export async function POST(req: Request) {
  const form = await req.formData();
  const res = await fetch(`${process.env.ASR_URL}/audio/transcriptions`, {
    method: "POST",
    body: form, // audio file + model name
  });
  return Response.json(await res.json());
}
```

Because vLLM exposes the OpenAI API shape, the same frontend code works against Version A and B — just swap `ASR_URL`.

## Suggested repo layout (satisfies the "open source + documented" requirement)

```text
indeep-webdemo/
├── docker-compose.yml
├── scripts/generate_samples.py   # offline Voxtral TTS → wav + spectrogram
├── app/                          # FastAPI + SQLite (Version A)
├── web/                          # Next.js frontend (shared, also Version B)
└── docs/                         # setup + "how to give a demo" guide
```

One caveat to flag to Tom: the **TTS weights are CC BY-NC**, the **ASR weights are Apache 2.0**. For a university/museum demo that's fine, but note it in the docs since "everything open source" was a requirement — the generated audio samples you ship are yours, so the static versions carry no license burden at all.

Want me to sketch the FastAPI backend + SQLite schema, or the `generate_samples.py` script for pre-rendering the Echt-of-Nep clips first?


---

### User

This plan would actually work and would be a good infrastructure idea for making this work ?

What would you say is needed for the rest of the demo. lets say we want to make the demo around 10-15 minutes long for those kids.

generate a plan for the infra and general demo idea


---

### Assistant (claude-fable-5)

<details>
<summary>Reasoning</summary>

I should verify that the Voxtral models I mentioned actually exist before the demo—a quick web search would let me confirm the specifics of Voxtral Mini Realtime and its TTS capabilities so I'm not making unsupported claims to the kids.
</details>

<details>
<summary>Reasoning</summary>

Let me verify the setup: the realtime model runs on vLLM's WebSocket API, and I need to enable vLLM-Omni with the `--omni` flag for TTS. Voice cloning through reference audio has limitations since the codec encoder isn't open-sourced, and the self-hosted version only supports 20 preset voices rather than full cloning. Now I'll map out a 10–15 minute demo sequence.
</details>

Yes — the plan holds up, and I just verified the details. A few corrections/refinements first, then the full demo plan.

## Infra: validated, with three corrections

1. **ASR (Voxtral Mini 4B Realtime 2602, Apache 2.0)** ✅ Confirmed: single 16 GB GPU, vLLM only (not Transformers <5.2, no llama.cpp), Dutch + English among 13 languages. **But**: it uses vLLM's new **Realtime API over WebSockets**, not the plain `/audio/transcriptions` REST endpoint I sketched. So your backend proxy should be a WebSocket relay, not a form-POST handler. Recommended `transcription_delay_ms: 480`.
2. **TTS (Voxtral 4B TTS 2603, CC BY-NC 4.0)** — served with `vllm serve mistralai/Voxtral-4B-TTS-2603 --omni` via **vLLM-Omni ≥ 0.18** (separate package/Docker image from plain vLLM). Exposes a simple `POST /v1/audio/speech` REST endpoint. ✅
3. **Important caveat**: the open-weight TTS release **does not include the codec encoder**, so self-hosted you get the **20 preset voices only** — true zero-shot voice cloning from arbitrary audio is API-only (or hacky community encoders). For the demo this is actually fine: 20 preset voices across 9 languages (incl. Dutch) is plenty to generate convincing fakes. It also conveniently sidesteps the ethics-committee issue of cloning visitors' voices.

The overall shape stays the same and gets even simpler: **run TTS once offline to generate the fake sample library, ship only the ASR container + FastAPI + SQLite to the museum server.** If the UvA server has no GPU, everything except live transcription still works.

Revised compose (correct commands):

```yaml
services:
  asr:
    image: vllm/vllm-openai:latest
    command: >
      mistralai/Voxtral-Mini-4B-Realtime-2602
      --compilation_config '{"cudagraph_mode": "PIECEWISE"}'
      --max-model-len 8192
    environment: [VLLM_DISABLE_COMPILE_CACHE=1]
    # WebSocket realtime endpoint; proxy from FastAPI

  app:
    build: ./app   # FastAPI + static frontend + SQLite in ./data
    ports: ["80:8000"]
```

(`--max-model-len 8192` since museum clips are seconds long, not 3 hours — saves a lot of VRAM.)

## Demo design: 10–15 minutes, 5 stations

Frame it as **"De Deepfake Detective Academie"** — the visitor is a trainee detective; the two AI personas guide them:

- 🟡 **Miko the Minion** (ASR) — eager, hears everything, writes it down, but is gullible
- 👮 **Agent Echo** (deepfake detective) — suspicious, looks at spectrograms, catches fakes

Visitor earns badges per station and gets a "Detective Diploma" at the end (score screen + aggregate stats).

| # | Station | Time | Tech | Persona |
|---|---------|------|------|---------|
| 1 | **In het brein van de AI** — speak (or play a clip); watch waveform → mel spectrogram → attention-ish highlights → text appear step by step | 2–3 min | Live ASR (or pre-processed fallback) | Miko |
| 2 | **Echt of Nep?** — 5 rounds: listen, swipe real/fake, then Agent Echo reveals the spectrogram clues (too-smooth harmonics, missing breaths, odd high-frequency band) | 3–4 min | Pre-generated Voxtral TTS fakes + real recordings (e.g. Common Voice NL, CC0) | Echo |
| 3 | **De compressie-machine** — slider: studio → phone call → WhatsApp voice note; hear AND see the spectrogram degrade; punchline: "compression hides the clues — even detectives struggle" | 2 min | 100% client-side Web Audio API | Echo |
| 4 | **Fop de Minion** — pick a sentence, a preset voice + language/accent, hear the fake; Miko transcribes it perfectly ("the minion can't tell it's fake — that's the problem!") | 2–3 min | Pre-generated combos (grid of sentence × voice), optionally live TTS later | Both |
| 5 | **Diploma & leaderboard** — your score vs. all visitors ("62% of people were fooled by clip 3"); one takeaway screen: 3 tips to spot audio deepfakes in real life | 1–2 min | SQLite aggregates | Both |

Stations 1–3 match exactly what Tom proposed in the email; 4–5 are cheap additions (station 4 is just a lookup grid of pre-rendered files, station 5 is one SQL query).

**Practical museum details:**

- Each station has a **skip/next button and a 90-second idle reset** (kiosk mode) so the flow self-paces to 10–15 min but tolerates a kid who runs off.
- **NL/EN toggle** top-right; all copy in a single `i18n.json`.
- Works on tablet/phone/laptop (their requirement): stations 2–5 are pure static assets + one tiny API; only station 1's live mode needs the GPU, and it degrades gracefully to a pre-recorded clip with the same visualization.
- Headphones per station, or big-button UI with visual feedback for noisy museum halls.

**Build order** (matching "start with the first three"):

1. Week 1–2: sample generation script + station 2 + 3 (fully static, deployable to your Next.js site immediately — this doubles as your Version B)
2. Week 3: station 1 with pre-processed clips + SQLite stats (station 5)
3. Week 4+: live ASR via WebSocket proxy, station 4, kiosk mode, docs

Want me to write the `generate_samples.py` (Voxtral TTS → wav + mel-spectrogram JSON for the frontend), or the WebSocket relay for station 1 first?


---

### User

Oke can you sketch out how the actual interactions go for 1-5 the "stations"


---

### Assistant (claude-fable-5)

<details>
<summary>Reasoning</summary>

I'm mapping out the interaction flows for the first five stations—what each kid sees on screen, the actions they take, and how the system responds to keep things moving and engaging.
</details>

Here's the screen-by-screen interaction design. Assume a tablet in landscape, big touch targets, minimal reading (voice-over/persona speech bubbles carry the story).

---

## Station 1 — "In het brein van de AI" (2–3 min)

**Goal:** intuition that AI doesn't "hear" like us — it turns sound into pictures, then patterns, then text.

1. **Intro:** Miko the Minion bounces in: *"Ik ben Miko! Ik schrijf op wat ik hoor. Wil je zien hoe mijn brein werkt?"* Big button: **▶ Speel een zin af** (or 🎤 **Zeg iets** in live mode).
2. **Step-through visualization** — one big "Volgende →" button advances 4 stages, each animating on the same clip:
   - **Stage A — Geluid:** waveform scrolls as audio plays. *"Dit is wat een microfoon voelt: trillingen!"*
   - **Stage B — Het geluids-plaatje:** waveform morphs into a mel spectrogram, painting left-to-right in sync with the audio. *"Ik maak er een plaatje van. Laag = onder, hoog = boven, fel = hard."* Kid can **tap the spectrogram** to hear that exact slice (scrubbing = the "aha" moment).
   - **Stage C — Stukjes herkennen:** boxes highlight on the spectrogram, one per phoneme-ish chunk, with a floating guess above each: `h… hɑ… hallo?` Some guesses flicker between options before settling — shows the AI *guessing*, not knowing.
   - **Stage D — Woorden:** the chunks snap together into the final transcript, typed out letter by letter. Confetti. *"Zo hoor ik!"*
3. **Play moment (30s):** *"Probeer Miko te foppen!"* Three trick buttons: play a whispered clip, a clip with music behind it, a mumbled clip. Transcript comes out partially wrong; wrong words wiggle in red. Miko: *"Oeps! Zonder duidelijk geluid gok ik maar wat…"*
4. **Badge:** 🧠 *Brein-kijker* → auto-advance prompt to Station 2.

*Live mode variant:* stage A–D run on the visitor's own recording (max 5s, not stored — button says "wordt niet bewaard").

---

## Station 2 — "Echt of Nep?" (3–4 min) — the core game

**Goal:** you can't trust your ears; detectives use spectrograms.

1. **Intro:** Agent Echo slides in: *"Miko trapt overal in. Ik niet. Word jij ook detective? 5 zaken. Luister goed."*
2. **Round loop (×5), each ~35s:**
   - **Case card** flips over: "Zaak 3/5" + a context sentence ("Iemand laat dit spraakbericht horen…").
   - **▶ Luister** (replayable, max 3×; replay counter shown as 🎧🎧🎧).
   - Two giant buttons: ✅ **ECHT** / 🤖 **NEP**. Kid taps.
   - **Reveal:** dramatic 1-s pause, stamp animation — "ECHT ✔" or "NEP ✘ — GESNAPT!" plus live stat: *"71% van de bezoekers trapte hierin!"*
   - **The clue (the teaching beat):** spectrogram slides up; Agent Echo's magnifying glass auto-zooms to the tell, circled in red:
     - fake #1: unnaturally smooth harmonics ("te perfect — echte mensen trillen")
     - fake #2: no breath before the sentence ("waar is de adem?")
     - fake #3 (hard one): almost clean — clue is a subtle high-frequency cutoff ("zelfs ik moest twee keer kijken")
   - On real clips, Echo points out the messy human bits: breaths, lip smacks, room echo.
   - Escalating difficulty: round 1 obvious robotic fake → round 5 near-perfect Voxtral clip.
3. **Score screen:** "Je hebt 4/5 zaken opgelost!" + comparison bar vs. average visitor vs. Agent Echo (who got 5/5) vs. Miko (who got 2/5, *"ik vond ze allemaal echt klinken 😅"*).
4. **Badge:** 🔍 *Nep-speurder*.

---

## Station 3 — "De compressie-machine" (2 min)

**Goal:** compression destroys evidence — why real-world detection is hard.

1. **Intro:** Echo: *"Wist je dat spraakberichten worden platgedrukt? Kijk wat er verdwijnt."*
2. **The one big interaction:** a vertical **slider** styled like a machine lever, with 4 detents:
   - 🎙️ **Studio** → ☎️ **Telefoon** → 💬 **WhatsApp** → 📻 **Heel slecht**
   - Audio **loops continuously** (a short sentence); dragging the lever crossfades between quality levels in real time — no play button needed.
   - Above the lever, the **spectrogram updates live**: at "Telefoon" the top half visibly gets chopped off with a "shutter" animation; at WhatsApp, blocky smearing appears.
3. **The connection-back moment:** the deepfake clue from Station 2 (the red-circled artifact) is overlaid as a ghost outline on this spectrogram. Drag the lever down and **watch the clue disappear**. Echo: *"Zie je? Het bewijs is weg. Daarom sturen boeven nepstemmen via spraakberichten…"*
4. **Mini-challenge (15s):** "Zaak heropend" — the hard clip from Station 2, but WhatsApp-compressed. Echt of nep? Almost everyone fails. Echo: *"Precies. Dit is waarom mijn werk moeilijk is."*
5. **Badge:** 🎚️ *Compressie-kenner*.

---

## Station 4 — "Fop de Minion" (2–3 min)

**Goal:** making a deepfake is scarily easy — and the "listener AI" can't tell.

1. **Intro:** Echo: *"Nu mag JIJ de boef zijn. Maak een nepstem en kijk of Miko het doorheeft."*
2. **Build-a-fake, 3 taps** (each a horizontal card carousel):
   - **Tap 1 — Kies een zin:** 4 pre-written sentences (funny/innocent: *"Ik heb je huiswerk opgegeten"*, *"Mam, kun je 20 euro overmaken?"* ← the scam one, deliberately)
   - **Tap 2 — Kies een stem:** 6 voice cards with cartoon avatars (deep man, kid-ish voice, grandma, etc. — the Voxtral preset voices)
   - **Tap 3 — Kies een taal/accent:** 🇳🇱 NL / 🇬🇧 EN / NL with accent
   - Big red button: **🏭 MAAK DE NEPSTEM** → factory animation (~2s), then the pre-generated clip plays. (It's a lookup in the 4×6×3 pre-rendered grid — feels generative, costs nothing.)
3. **The payoff:** the clip is "sent" to Miko (envelope animation). Miko listens, transcribes it perfectly, and replies cheerfully: *"Klinkt prima! Bericht ontvangen van… mama? ✔"* Then Agent Echo bursts in, scans it, red alert: **"NEP! 🚨"** with the spectrogram clue.
4. **The lesson beat (one screen, big text):** *"Miko verstond het perfect — maar wist niet dat het nep was. Daarom heb je ALLEBEI nodig: een luisteraar én een detective."* ← this is the core message of the whole demo, landed through play.
5. If they chose the money-scam sentence, an extra Echo tip: *"Krijg je zo'n bericht? Bel terug op het echte nummer!"*
6. **Badge:** 🏭 *Nepstem-maker*.

---

## Station 5 — "Detective Diploma" (1–2 min)

**Goal:** consolidate, take-home tips, shareable ending, feed the stats loop.

1. **Diploma animation:** scroll unrolls with their name-free avatar, 4 badges, and rank based on Station 2 score: *Speurneus* (0–2), *Detective* (3–4), *Meester-detective* (5).
2. **Leaderboard-ish stats screen** (aggregate, from SQLite): "Vandaag: 214 bezoekers, gemiddeld 3.1/5 goed. Moeilijkste zaak: fragment 5 — 78% gefopt." Kids love seeing "everyone else got fooled too."
3. **3 tips om thuis te onthouden** (illustrated, one line each):
   - Luister naar adem en foutjes — echte mensen zijn rommelig
   - Rare vraag om geld/geheimen? Bel terug op het echte nummer
   - Ook slimme mensen (en slimme AI's zoals Miko) trappen erin — checken is normaal, niet dom
4. **End buttons:** 🔁 **Opnieuw** (resets to Station 1) + optional **QR code** linking to the public web version (your Next.js deployment) so they can replay at home / show parents.
5. Auto-reset to attract-mode after 45s idle: looping screen with Miko & Echo beckoning — *"Word detective! Raak het scherm aan."*

---

## Cross-cutting interaction rules

- **One primary action per screen**, always bottom-center, always huge.
- **Personas do all the explaining** via short speech bubbles + optional TTS voice-over (nice dogfooding: Miko's voice is literally a Voxtral preset voice — reveal that in Station 4!).
- **Progress bar** top of screen: 5 dots, current station glowing — kids see the end is near, adults can gauge the 15 min.
- **Skip anywhere** (small "→" top-right) and **90s idle → attract mode** so an abandoned session never blocks the next visitor.
- **Sound design:** stamp thunks, correct/wrong chimes — audible feedback matters at a *sound* exhibit.
- All state for a session lives client-side; only anonymous events (`station, clip_id, guess, correct, lang, timestamp`) POST to SQLite for the stats.

Want me to turn this into the actual data model + API contract (the 3 endpoints and SQLite schema), or start with the Station 2 frontend component structure?
