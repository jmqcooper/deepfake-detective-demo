"use client";

import { useCallback, useState } from "react";
import {
  useEvents,
  useIdleReset,
  useLang,
  useManifest,
  useSession,
  useT,
  type Lang,
} from "@/components/kiosk/hooks";
import {
  BigButton,
  LangToggle,
  Persona,
  ProgressRail,
  StationCard,
} from "@/components/kiosk/ui";
import { Station1Brain } from "@/components/stations/Station1Brain";
import { Station2RealOrFake } from "@/components/stations/Station2RealOrFake";
import { Station3Compression } from "@/components/stations/Station3Compression";
import { Station4Factory } from "@/components/stations/Station4Factory";
import { Station5Diploma } from "@/components/stations/Station5Diploma";

/** -1 is the attract screen a passer-by sees; 0..4 are the five stations. */
type Screen = -1 | 0 | 1 | 2 | 3 | 4;

const IDLE_MS = 90_000;

/** Stations that open with a mission briefing. Station 5 IS the outro. */
const BRIEFED_STATIONS = new Set<Screen>([0, 1, 2, 3]);

export function DemoShell() {
  const [lang, setLang] = useLang();
  const t = useT(lang);
  const manifest = useManifest();
  const { sessionId, reset: resetSession } = useSession();
  const track = useEvents(sessionId, lang);

  const [screen, setScreen] = useState<Screen>(-1);
  const [briefing, setBriefing] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);

  const restart = useCallback(() => {
    setScreen(-1);
    setBriefing(false);
    setScore(0);
    setTotal(0);
    resetSession();
  }, [resetSession]);

  /**
   * Every station opens on its briefing: the persona states the mission BEFORE
   * the visitor is dropped into an interaction. The abrupt station-to-station
   * jump was the single biggest "where am I?" moment in the old flow.
   */
  const go = useCallback((next: Screen) => {
    setScreen(next);
    setBriefing(BRIEFED_STATIONS.has(next));
  }, []);

  const beginStation = useCallback(() => {
    setBriefing(false);
    // station_enter fires when the visitor actually starts, not on the briefing,
    // so dwell-time stats measure the interaction rather than the title card.
    track({ station: screen + 1, type: "station_enter" });
  }, [screen, track]);

  // A visitor who wanders off must never block the next one.
  useIdleReset(screen === -1 ? 0 : IDLE_MS, restart);

  if (manifest.status === "loading") {
    return <Centered>{t("common.loading")}</Centered>;
  }

  if (manifest.status === "missing") {
    return (
      <Centered>
        <div className="max-w-xl space-y-4 text-center">
          <p className="text-3xl font-black text-miko-400">
            {t("setup.title")}
          </p>
          <p className="text-white/70">{t("setup.body")}</p>
          <code className="block rounded-xl bg-ink-900 px-4 py-3 font-mono text-sm text-echo-300">
            bash tools/fetch_dutch_pack.sh && python tools/prepare_samples.py
          </code>
        </div>
      </Centered>
    );
  }

  const { clips, codecLadder } = manifest.manifest;
  const allCases = clips.filter((c) => !c.id.startsWith("station1"));
  // Every station follows the interface language when the pack has that
  // language; otherwise it falls back to the Dutch originals.
  const langCases = allCases.filter((c) => (c.lang ?? "nl") === lang);
  const cases = langCases.length >= 10 ? langCases : allCases.filter((c) => (c.lang ?? "nl") === "nl");
  const walkthrough =
    (lang === "en" ? clips.find((c) => c.id === "station1-en") : undefined) ??
    clips.find((c) => c.id === "station1") ??
    cases[0];
  const fakes = cases.filter((c) => c.label === "fake");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Persona who="miko" size={40} />
          <Persona who="echo" size={40} />
          <h1 className="ml-2 hidden text-lg font-extrabold tracking-tight text-white/90 sm:block md:text-xl">
            {screen >= 0 ? t(`station${screen + 1}.name`) : t("app.title")}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {screen >= 0 && <ProgressRail total={5} current={screen} />}
          <LangToggle lang={lang} onChange={setLang} />
          {screen >= 0 && screen < 4 && (
            <button
              type="button"
              onClick={() => go((screen + 1) as Screen)}
              className="grid h-10 w-10 place-items-center rounded-[14px] bg-ink-800 text-ink-400 ring-1 ring-white/10 transition-[transform,color] duration-150 ring-inset hover:text-white active:scale-[0.96]"
              aria-label={t("common.skip")}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path
                  d="M3 9h11M10 5l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Keyed on screen + briefing so every scene change replays its entrance —
          the StationCard `pop` doubles as the scene transition. */}
      <div
        key={`${screen}:${briefing ? "brief" : "station"}`}
        className="flex flex-1 items-center"
      >
        {screen === -1 && <Attract lang={lang} onStart={() => go(0)} />}

        {screen >= 0 && briefing && (
          <Briefing station={screen} lang={lang} onStart={beginStation} />
        )}

        {screen === 0 && !briefing && (
          <Station1Brain
            key={walkthrough.id}
            clip={walkthrough}
            lang={lang}
            onDone={() => go(1)}
          />
        )}

        {screen === 1 && !briefing && (
          <Station2RealOrFake
            key={lang}
            clips={cases}
            lang={lang}
            track={track}
            onDone={(s, tot) => {
              setScore(s);
              setTotal(tot);
              // The score rides on session_complete, not here — per-station scores
              // would otherwise get double-counted into the summary average.
              track({ station: 2, type: "station_complete" });
              go(2);
            }}
          />
        )}

        {screen === 2 && !briefing && (
          <Station3Compression
            ladder={codecLadder}
            lang={lang}
            onDone={() => go(3)}
          />
        )}

        {screen === 3 && !briefing && (
          <Station4Factory
            factory={manifest.manifest.fakeFactory}
            fallbackFakes={fakes}
            lang={lang}
            onDone={() => {
              track({ station: 5, type: "session_complete", score });
              go(4);
            }}
          />
        )}

        {screen === 4 && (
          <Station5Diploma
            score={score}
            total={total || 5}
            lang={lang}
            onRestart={restart}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The mission card between stations. Context lands BEFORE the interaction:
 * who is speaking, what the mission is, one button. Doubles as a breather so
 * the five stations read as chapters instead of one endless screen.
 */
function Briefing({
  station,
  lang,
  onStart,
}: {
  station: Screen;
  lang: Lang;
  onStart: () => void;
}) {
  const t = useT(lang);
  const who = station === 0 ? "miko" : "echo";
  const n = station + 1;

  return (
    <StationCard>
      <div className="flex flex-col items-center gap-6 py-8 text-center">
        <p className="rise font-mono text-xs font-bold tracking-[0.24em] text-ink-400 uppercase tnum">
          {t("brief.mission", { n, total: 5 })}
        </p>
        <Persona
          who={who}
          size={124}
          mood={who === "miko" ? "listening" : "idle"}
          className="pop breathe"
        />
        <h2
          className="rise max-w-3xl text-4xl font-black text-white md:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          {t(`brief.b${n}.title`)}
        </h2>
        <p
          className="rise max-w-2xl text-lg font-semibold text-white/80 md:text-xl"
          style={{ animationDelay: "180ms" }}
        >
          {t(`brief.b${n}.text`)}
        </p>
        <BigButton
          onClick={onStart}
          tone={who}
          className="halo mt-2"
        >
          {t("brief.start")}
        </BigButton>
      </div>
    </StationCard>
  );
}

function Attract({ lang, onStart }: { lang: Lang; onStart: () => void }) {
  const t = useT(lang);
  return (
    <StationCard>
      <div className="flex flex-col items-center gap-6 py-4 text-center">
        {/* The two of them, side by side, before a word is read: one round and
            open, one hard-edged and watchful. The whole premise in a silhouette.
            The stagger on the second breathe keeps them from bobbing in lockstep,
            which reads as a looping GIF rather than two characters. */}
        <div className="flex items-end gap-10">
          <Persona who="miko" size={132} mood="listening" className="breathe" />
          <Persona
            who="echo"
            size={150}
            className="breathe"
            style={{ animationDelay: "1.2s" }}
          />
        </div>

        {/* A sound wave between them and the title: this is a SOUND exhibit,
            and the motif should read before any copy does. Heights are a fixed
            pattern (not random) so server and client render identically. */}
        <div className="flex h-8 items-end gap-1" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={i}
              className="w-1.5 rounded-full bg-echo-400/50"
              style={{
                height: `${28 + ((i * 37) % 62)}%`,
                transformOrigin: "bottom",
                animation: `bar ${0.9 + (i % 5) * 0.14}s ease-in-out ${i * 0.07}s infinite`,
              }}
            />
          ))}
        </div>

        {/* Title, one hook line, one button. Anything more on an attract
            screen is furniture a passer-by has to read past. */}
        <div className="space-y-3">
          <h2 className="rise text-4xl font-black text-white md:text-6xl">
            {t("app.title")}
          </h2>
          <p
            className="rise text-lg font-bold text-miko-300 md:text-xl"
            style={{ animationDelay: "100ms" }}
          >
            {t("app.hook")}
          </p>
        </div>

        <BigButton onClick={onStart} tone="miko" className="halo mt-1">
          {t("app.start")}
        </BigButton>
      </div>
    </StationCard>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-8">{children}</main>
  );
}
