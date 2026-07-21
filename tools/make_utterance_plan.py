#!/usr/bin/env python3
"""Generate the stakeholder utterance plan (web/public/plan.html).

A single self-contained page that walks through the five missions, lists every
utterance the demo ships (real and synthetic, Dutch and English) with playable
audio, shows how each clip serves its story beat, and marks the open decision
points. Generated from the manifest and the Dutch-pack cache, so it cannot
drift from what the demo actually plays.

Serve it from the app (localhost:3000/plan.html) so the relative audio paths
resolve; it is deliberately excluded from the kiosk flow.
"""

from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "web/public/samples"
CACHE = ROOT / "tools/.cache/dutch"
OUT = ROOT / "web/public/plan.html"

# Voice labels are language-dependent: the language-neutral presets are clean
# in English but carry an audible accent on Dutch.
FEMALE = {"nl_female", "neutral_female", "casual_female", "cheerful_female"}


def voice_label(voice: str | None, lang: str) -> str:
    if not voice:
        return "—"
    base = "vrouw" if voice in FEMALE else "man"
    if lang == "nl" and voice not in {"nl_female", "nl_male"}:
        return f"{voice} ⚠ accent op NL"
    style = voice.split("_")[0]
    suffix = {"nl": "NL", "neutral": "neutraal", "casual": "casual",
              "cheerful": "vrolijk"}.get(style, style)
    return f"{base} ({suffix})"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def audio(src: str) -> str:
    return f'<audio controls preload="none" src="{esc(src)}"></audio>'


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


manifest = load(SAMPLES / "manifest.json")
packs = {}
for _lang in ("nl", "en"):
    _p = ROOT / f"tools/.cache/pack-{_lang}/pack.json"
    if _p.is_file():
        packs[_lang] = load(_p)
clips = {c["id"]: c for c in manifest["clips"]}
station1 = clips["station1"]
station1_en = clips.get("station1-en")
cases = [c for c in manifest["clips"] if c["id"].startswith("case-")]
ladder = manifest["codecLadder"]
factory = manifest["fakeFactory"]

s1_meta = load(CACHE / "station1_source.json")
s1_en_meta = load(CACHE / "station1_source_en.json")
ladder_meta = load(CACHE / "ladder_source.json")
ladder_en_meta = load(CACHE / "ladder_source_en.json")


def case_rows(lang: str) -> str:
    pack = packs[lang]
    by_source = {c["sourceId"]: c for c in pack["cases"]}
    rows = []
    for c in cases:
        if c.get("lang", "nl") != lang:
            continue
        case = by_source.get(c["provenance"]["sourceId"], {})
        is_fake = c["label"] == "fake"
        voice = case.get("voice") if is_fake else "mens (Common Voice)"
        label_text = voice_label(voice, lang) if is_fake else voice
        rows.append(f"""
        <tr>
          <td class="mono">{esc(c["id"])}</td>
          <td><span class="tag {'tag-fake' if is_fake else 'tag-real'}">{'NEP' if is_fake else 'ECHT'}</span></td>
          <td class="tnum">{c["difficulty"]}</td>
          <td>{esc(label_text)}</td>
          <td class="quote">{esc(case.get("text", ""))}</td>
          <td>{audio(f"samples/audio/{c['id']}.mp3")}</td>
        </tr>""")
    return "".join(rows)


def ladder_rows() -> str:
    rows = []
    for r in ladder:
        rate = f'{r["bitrateKbps"]} kbit/s' if r["bitrateKbps"] else "vol"
        rows.append(f"""
        <tr>
          <td class="mono">{esc(r["id"])}</td>
          <td class="tnum">{rate}</td>
          <td>{audio("samples/codec/" + r["id"] + ".mp3")}</td>
          <td class="quote">{esc(r.get("transcript", "") or "— (hoort niets)")}</td>
          <td>{audio("samples/codec/" + r["id"] + "_en.mp3") if r.get("audioEn") else "—"}</td>
        </tr>""")
    return "".join(rows)


def factory_rows() -> str:
    rows = []
    order = sorted(factory["clips"], key=lambda c: (c["sentenceId"], c.get("lang", "nl"), c["voice"]))
    for c in order:
        lang = c.get("lang", "nl")
        rows.append(f"""
        <tr>
          <td class="mono">{esc(c["sentenceId"])}</td>
          <td>{esc(lang.upper())}</td>
          <td>{esc(voice_label(c["voice"], c.get("lang", "nl")))}</td>
          <td class="quote">{esc(c["text"])}{' <span class="tag tag-fake">scam-zin</span>' if c["scam"] else ''}</td>
          <td>{audio("samples/factory/" + c["id"] + ".mp3")}</td>
          <td class="quote small">{esc(c["transcript"])}</td>
        </tr>""")
    return "".join(rows)


page = f"""<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Utterance-plan — De Deepfake Detective Academie</title>
<style>
  :root {{
    --ink: #16203a; --muted: #5b6785; --line: #e3e7f0;
    --miko: #f5a623; --echo: #0e9488; --fake: #e23a5f; --real: #199a68;
    --paper: #fbfbfd; --card: #ffffff;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--paper); color: var(--ink);
    font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
  }}
  main {{ max-width: 60rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }}
  h1 {{ font-size: 2.1rem; line-height: 1.15; margin: 0 0 .4rem; letter-spacing: -0.02em; }}
  h2 {{ font-size: 1.35rem; margin: 0; letter-spacing: -0.01em; }}
  .sub {{ color: var(--muted); margin: 0 0 2.5rem; }}
  section {{ background: var(--card); border: 1px solid var(--line); border-radius: 14px;
             padding: 1.6rem 1.8rem; margin: 1.4rem 0; }}
  .stephead {{ display: flex; align-items: baseline; gap: .8rem; margin-bottom: .3rem; }}
  .stepnum {{ font: 700 .75rem/1 ui-monospace, monospace; letter-spacing: .12em;
              color: var(--echo); text-transform: uppercase; }}
  .beat {{ color: var(--muted); margin: .2rem 0 1rem; }}
  table {{ width: 100%; border-collapse: collapse; font-size: .88rem; }}
  th {{ text-align: left; font: 700 .68rem/1.2 ui-monospace, monospace; letter-spacing: .1em;
        text-transform: uppercase; color: var(--muted); padding: .45rem .6rem;
        border-bottom: 2px solid var(--line); }}
  td {{ padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: middle; }}
  tr.warn td {{ background: #fff7ed; }}
  .quote {{ font-style: italic; }}
  .small {{ font-size: .8rem; color: var(--muted); }}
  .mono {{ font-family: ui-monospace, monospace; font-size: .8rem; }}
  .tnum {{ font-variant-numeric: tabular-nums; }}
  audio {{ height: 30px; width: 220px; }}
  .tag {{ display: inline-block; font: 700 .66rem/1 ui-monospace, monospace; letter-spacing: .08em;
          padding: .25rem .5rem; border-radius: 6px; color: #fff; }}
  .tag-real {{ background: var(--real); }}
  .tag-fake {{ background: var(--fake); }}
  .decide {{ border-left: 4px solid var(--miko); background: #fff9ee;
             padding: .8rem 1rem; border-radius: 0 10px 10px 0; margin-top: 1.1rem; }}
  .decide b {{ font: 700 .7rem/1 ui-monospace, monospace; letter-spacing: .1em;
               text-transform: uppercase; color: #9a6a12; display: block; margin-bottom: .3rem; }}
  .persona {{ display: inline-block; padding: .15rem .55rem; border-radius: 999px;
              font-weight: 700; font-size: .8rem; color: #fff; }}
  .p-miko {{ background: var(--miko); }}
  .p-echo {{ background: var(--echo); }}
  .arc {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: .6rem; margin: 1rem 0 .4rem; }}
  .arc div {{ background: #f2f4f9; border: 1px solid var(--line); border-radius: 10px;
              padding: .6rem .7rem; font-size: .8rem; }}
  .arc b {{ display: block; font-size: .85rem; margin-bottom: .15rem; }}
  .legend {{ font-size: .8rem; color: var(--muted); margin-top: .5rem; }}
  @media print {{ audio {{ display: none; }} section {{ break-inside: avoid; }} }}
</style>
</head>
<body>
<main>
  <h1>De Deepfake Detective Academie<br><span style="color:var(--muted);font-weight:600">utterance-plan &amp; verhaallijn</span></h1>
  <p class="sub">Alle audio die de demo gebruikt (echt en synthetisch, NL en EN), per missie,
  met de rol van elke zin in het verhaal — plus de beslispunten. Audio is afspeelbaar in dit document.</p>

  <section>
    <div class="stephead"><span class="stepnum">Het verhaal in één regel</span></div>
    <h2>Twee AI's, één les</h2>
    <p class="beat"><span class="persona p-miko">Miko</span> is de luisteraar (echte spraakherkenning:
    Voxtral ASR) — hij verstaat alles, maar gelooft alles. <span class="persona p-echo">Agent Echo</span>
    is de detective — hij leest geluids-plaatjes en vangt nepstemmen. De bezoeker leert:
    <i>verstaan en controleren zijn twee verschillende banen; je hebt allebei nodig.</i></p>
    <div class="arc">
      <div><b>1 · Het brein</b>Hoe Miko hoort: trillingen → plaatje → stukjes → zwart doosje → woorden</div>
      <div><b>2 · Echt of Nep?</b>Vijf opnames uit Echo's archief; de bezoeker oordeelt</div>
      <div><b>3 · Compressie</b>Spraakberichten verstaan blijft lukken, maar Echo's bewijs verdwijnt</div>
      <div><b>4 · De fabriek</b>De bezoeker maakt zélf een nepstem; Miko trapt erin, Echo niet</div>
      <div><b>5 · Diploma</b>Score, drie tips, en: gefopt worden is normaal</div>
    </div>
  </section>

  <section>
    <div class="stephead"><span class="stepnum">Stap 1 · Missie 1</span></div>
    <h2>In het brein van de spraak-AI</h2>
    <p class="beat">Eén zin, door ons geschreven, gericht aan Miko zelf. De bezoeker ziet hem
    veranderen van trilling naar plaatje naar woorden — inclusief Miko's échte fout
    (hij verstaat zijn eigen naam verkeerd: dat is de les "ik gok").</p>
    <table>
      <tr><th>Taal</th><th>Stem</th><th>Geschreven zin</th><th>Audio</th><th>Wat Miko opschrijft (echt ASR)</th></tr>
      <tr>
        <td>NL</td><td>{esc(voice_label(s1_meta["voice"], "nl"))}</td>
        <td class="quote">{esc(s1_meta["text"])}</td>
        <td>{audio("samples/audio/station1.mp3")}</td>
        <td class="quote small">{esc(station1.get("transcript", ""))}</td>
      </tr>
      <tr>
        <td>EN</td><td>{esc(voice_label(s1_en_meta["voice"], "en"))}</td>
        <td class="quote">{esc(s1_en_meta["text"])}</td>
        <td>{audio("samples/audio/station1-en.mp3")}</td>
        <td class="quote small">{esc((station1_en or {}).get("transcript", ""))}</td>
      </tr>
    </table>
    <div class="decide"><b>Beslispunt 1</b>
    Is deze openingszin goed zo? Alternatief voorstel welkom — de zin moet kort, modern
    en grappig zijn, en "Miko" mag fout verstaan worden (dat ondersteunt de les).</div>
  </section>

  <section>
    <div class="stephead"><span class="stepnum">Stap 2 · Missie 2</span></div>
    <h2>Echt of Nep? — tien zaken per taal</h2>
    <p class="beat">Het hart van de demo, nu in twee volledige talen. Echte stemmen komen uit
    <i>Common Voice</i> (CC0): moderne, alledaagse zinnen, per zaak een andere echte spreker.
    Nepstemmen zijn Voxtral-TTS met uitsluitend schone stemmen (NL: native Nederlands;
    EN: accentloos neutraal). Alles exact 4,0&nbsp;s, gelijk volume, gelijk formaat — alleen
    <i>luisteren</i> geeft het antwoord. Echte en nepzinnen zijn gescheiden, zodat de inhoud
    het label nooit verraadt. Per ronde trekt de demo vijf zaken: per moeilijkheidsgraad
    óf de echte óf de nepstem.</p>
    <p class="beat"><b>Over stemvariatie:</b> het TTS-model kent 20 preset-stemmen, maar de
    "accent"-stemmen zijn de moedertaal-stemmen van ándere talen (Duits, Frans, Spaans…) —
    Nederlands via die stemmen klinkt als een buitenlands accent en is afgekeurd. Native
    Nederlands heeft het model er precies twee (man/vrouw); de variatie in de NL-ronde komt van
    de vijf verschillende échte sprekers. Engels heeft vijf accentloze stemmen — daar heeft elke
    nepzaak een eigen stem.</p>
    <h3 style="margin:.6rem 0 .2rem">Nederlands</h3>
    <table>
      <tr><th>Zaak</th><th>Label</th><th>Tier</th><th>Stem</th><th>Zin</th><th>Audio (4s fragment)</th></tr>
      {case_rows("nl")}
    </table>
    <h3 style="margin:1.2rem 0 .2rem">English</h3>
    <table>
      <tr><th>Case</th><th>Label</th><th>Tier</th><th>Voice</th><th>Sentence</th><th>Audio (4s clip)</th></tr>
      {case_rows("en")}
    </table>
    <div class="decide"><b>Beslispunt 2</b>
    De selectie is automatisch gescreend (de zaken waarvan de ASR de zin het best verstond),
    en de moeilijkheidsgraad is een startpunt op basis van diezelfde score. Vraag aan de groep:
    luister de twintig fragmenten na en keur de selectie + volgorde goed, of wijs vervangers aan
    (er staan per taal 8 extra echte kandidaten en 3 extra nepstemmen klaar).</div>
  </section>

  <section>
    <div class="stephead"><span class="stepnum">Stap 3 · Missie 3</span></div>
    <h2>De compressie-machine</h2>
    <p class="beat">Eén door ons geschreven zin, vier kwaliteiten (studio → telefoon → spraakbericht →
    heel krakerig). De machine speelt ze één voor één. De les is de omkering: <i>jij en Miko verstaan
    alles nog — maar Echo's bewijs bovenin het plaatje is weg.</i> Dáárom sturen oplichters
    nepstemmen als spraakbericht.</p>
    <p class="beat">NL: <span class="quote">{esc(ladder_meta["text"])}</span> ({esc(voice_label(ladder_meta["voice"], "nl"))})<br>
    EN: <span class="quote">{esc(ladder_en_meta["text"])}</span> ({esc(voice_label(ladder_en_meta["voice"], "en"))})</p>
    <table>
      <tr><th>Stand</th><th>Bitrate</th><th>Audio NL</th><th>Wat Miko hoort (echt ASR, NL)</th><th>Audio EN</th></tr>
      {ladder_rows()}
    </table>
    <div class="decide"><b>Beslispunt 3</b>
    De museumzin ("kom je vanmiddag naar het museum…") — houden, of een andere zin die beter bij
    de eindtentoonstelling past?</div>
  </section>

  <section>
    <div class="stephead"><span class="stepnum">Stap 4 · Missie 4</span></div>
    <h2>De nepstem-fabriek</h2>
    <p class="beat">De bezoeker is nu zelf de boef: kies een zin, kies een stem (vrouw/man),
    luister vooraf, en stuur naar Miko. Miko schrijft alles perfect op en keurt het goed;
    Echo slaat alarm. De scam-zin is er bewust bij — daar hangt de gezinsles aan
    ("bel terug op het échte nummer").</p>
    <table>
      <tr><th>Zin</th><th>Taal</th><th>Stem</th><th>Tekst</th><th>Audio</th><th>Wat Miko opschrijft</th></tr>
      {factory_rows()}
    </table>
    <div class="decide"><b>Beslispunt 4</b>
    Zijn deze vier zinnen de juiste? Eisen: herkenbaar voor een kind van 8, één scam-zin,
    geen zinnen die op de archiefzaken lijken.</div>
  </section>

  <section>
    <div class="stephead"><span class="stepnum">Stap 5 · Missie 5</span></div>
    <h2>Detective Diploma</h2>
    <p class="beat">Geen nieuwe audio. Score, vier badges, drie tips om thuis te onthouden
    (adem &amp; foutjes · bel terug op het echte nummer · checken is slim), en de geruststelling
    uit de bezoekersstatistiek: "X% trapte hier ook in."</p>
    <div class="decide"><b>Beslispunt 5</b>
    Akkoord op de drie thuis-tips zoals geformuleerd? Dit is de tekst die bezoekers letterlijk
    mee naar huis nemen.</div>
  </section>

  <section>
    <div class="stephead"><span class="stepnum">Herkomst &amp; eerlijkheid</span></div>
    <h2>Waar elke stem vandaan komt</h2>
    <p class="beat">Echte stemmen: Common Voice 17 (CC0, Mozilla) — echte vrijwilligers, NL en EN.
    Nepstemmen: mistralai/Voxtral-4B-TTS (CC&nbsp;BY-NC — niet-commercieel).
    Alles wat Miko "opschrijft" is échte ASR-uitvoer van mistralai/Voxtral-Mini-Realtime,
    gedraaid op precies de audio die de bezoeker hoort — fouten incluis, nooit met de hand
    geschreven. Elk geluids-plaatje is berekend uit datzelfde bestand.</p>
  </section>
</main>
</body>
</html>
"""

OUT.write_text(page, encoding="utf-8")
print(f"wrote {OUT} ({len(page)} bytes)")
