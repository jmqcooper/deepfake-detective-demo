"use client";

import { useCallback, useReducer, useState } from "react";
import {
  useEvents,
  useIdleReset,
  useLang,
  useManifest,
  useSession,
  useT,
  type Lang,
} from "@/components/kiosk/hooks";
import { Announcer, announce } from "@/components/kiosk/announcer";
import {
  BigButton,
  LangToggle,
  Persona,
  ProgressRail,
  StationCard,
} from "@/components/kiosk/ui";
import { SoundCheck } from "@/components/kiosk/SoundCheck";
import {
  flowReducer,
  idleTimeoutMs,
  initialFlow,
  stationNumber,
  STATION_COUNT,
  transitionTelemetry,
  type FlowAction,
  type StationIndex,
} from "@/lib/kiosk-flow";
import { casePool, walkthroughClip } from "@/lib/quiz";
import type { FakeFactory } from "@/components/manifest-types";
import { Station1Brain } from "@/components/stations/Station1Brain";
import { Station2RealOrFake } from "@/components/stations/Station2RealOrFake";
import { Station3Compression } from "@/components/stations/Station3Compression";
import { Station4Factory } from "@/components/stations/Station4Factory";
import { Station5Diploma } from "@/components/stations/Station5Diploma";

export function DemoShell() {
  const [lang, setLang] = useLang();
  const t = useT(lang);
  const manifest = useManifest();
  const { sessionId, reset: resetSession } = useSession();
  const track = useEvents(sessionId, lang);

  const [flow, dispatch] = useReducer(flowReducer, undefined, initialFlow);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);

  /**
   * Every transition goes through here, so every station reports its own
   * completion and every skip is visible in the funnel. Station 2 used to be
   * the only one that reported anything, and skipping reported nothing at all.
   */
  const go = useCallback(
    (action: FlowAction) => {
      dispatch(action);
      if (action.type === "advance" || action.type === "skip") {
        const telemetry = transitionTelemetry(flow, action.type);
        if (telemetry) void track(telemetry);
      }
    },
    [flow, track],
  );

  const restart = useCallback(() => {
    void track({ station: stationNumber(flow.station), type: "session_reset" });
    dispatch({ type: "restart" });
    setScore(0);
    setTotal(0);
    resetSession();
  }, [flow.station, resetSession, track]);

  const finishVisit = useCallback(async () => {
    await track({ station: 5, type: "station_complete" });
    restart();
  }, [restart, track]);

  const beginStation = useCallback(() => {
    dispatch({ type: "beginStation" });
    // station_enter fires when the visitor actually starts, not on the briefing,
    // so dwell-time stats measure the interaction rather than the title card.
    void track({ station: stationNumber(flow.station), type: "station_enter" });
    announce(t(`station${stationNumber(flow.station)}.name`));
  }, [flow.station, t, track]);

  // A visitor who wanders off must never block the next one. Station 5 resets
  // sooner than the rest — a finished visitor is standing there reading.
  useIdleReset(idleTimeoutMs(flow), restart);

  if (manifest.status === "loading") {
    return <Centered>{t("common.loading")}</Centered>;
  }

  if (manifest.status === "missing" || manifest.status === "malformed") {
    return (
      <Centered>
        <div className="max-w-xl space-y-4 text-center">
          <p className="text-2xl font-black text-miko-400 sm:text-3xl">
            {t(manifest.status === "malformed" ? "setup.brokenTitle" : "setup.title")}
          </p>
          <p className="text-white/70">
            {t(manifest.status === "malformed" ? "setup.brokenBody" : "setup.body")}
          </p>
          <code className="block overflow-x-auto rounded-xl bg-ink-900 px-4 py-3 text-left font-mono text-xs text-echo-300 sm:text-sm">
            bash tools/fetch_dutch_pack.sh &amp;&amp; python tools/prepare_samples.py
          </code>
          {manifest.status === "malformed" && (
            <ul className="space-y-1 text-left font-mono text-[11px] text-ink-400">
              {manifest.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      </Centered>
    );
  }

  const { clips, codecLadder } = manifest.manifest;
  // Every station follows the interface language when the pack has that
  // language; otherwise it falls back to the Dutch originals.
  const cases = casePool(clips, lang);
  const walkthrough = walkthroughClip(clips, lang) ?? cases[0];
  const fakes = cases.filter((c) => c.label === "fake");
  const showChrome = flow.phase !== "attract";
  const canSkip =
    flow.phase !== "attract" &&
    flow.phase !== "soundCheck" &&
    flow.station < STATION_COUNT - 1;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 overflow-x-hidden p-3 sm:gap-6 sm:p-4 md:p-8">
      <Announcer />

      {/* Two rows on purpose. Squeezing personas, title, a five-segment rail, a
          language switch and a skip button onto one line overflowed a 320px
          viewport by roughly a third — the skip control, the one thing that
          unblocks an abandoned kiosk, was the part that fell off the edge. */}
      <header className="flex flex-col gap-2 sm:gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden items-center gap-2 sm:flex" aria-hidden>
              <Persona who="miko" size={36} />
              <Persona who="echo" size={36} />
            </span>
            <h1 className="min-w-0 truncate text-base font-extrabold tracking-tight text-white/90 sm:ml-1 sm:text-lg md:text-xl">
              {flow.phase === "attract"
                ? t("app.title")
                : t(`station${stationNumber(flow.station)}.name`)}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <LangToggle
              lang={lang}
              onChange={setLang}
              groupLabel={t("common.langGroup")}
            />
            {canSkip && (
              <button
                type="button"
                onClick={() => go({ type: "skip" })}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-ink-800 text-ink-400 ring-1 ring-white/10 transition-[transform,color] duration-150 ring-inset hover:text-white active:scale-[0.96]"
                aria-label={t("common.skipStation", {
                  n: stationNumber(flow.station),
                })}
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
        </div>

        {showChrome && flow.phase !== "soundCheck" && (
          <div className="flex items-center gap-3">
            <ProgressRail
              total={STATION_COUNT}
              current={flow.station}
              label={t("brief.mission", {
                n: stationNumber(flow.station),
                total: STATION_COUNT,
              })}
            />
            <span className="truncate font-mono text-[10px] tracking-[0.18em] text-ink-400 uppercase tnum">
              {t("brief.mission", {
                n: stationNumber(flow.station),
                total: STATION_COUNT,
              })}
            </span>
          </div>
        )}
      </header>

      {/* Keyed on the phase + station so every scene change replays its entrance —
          the StationCard `pop` doubles as the scene transition. */}
      <div
        key={`${flow.phase}:${flow.station}`}
        className="flex min-w-0 flex-1 items-center"
      >
        {flow.phase === "attract" && (
          <Attract lang={lang} onStart={() => go({ type: "start" })} />
        )}

        {flow.phase === "soundCheck" && (
          <SoundCheck
            lang={lang}
            clip={walkthrough}
            onDone={() => go({ type: "soundCheckDone" })}
          />
        )}

        {flow.phase === "briefing" && (
          <Briefing station={flow.station} lang={lang} onStart={beginStation} />
        )}

        {flow.phase === "station" && flow.station === 0 && walkthrough && (
          <Station1Brain
            key={walkthrough.id}
            clip={walkthrough}
            lang={lang}
            onDone={() => go({ type: "advance" })}
          />
        )}

        {flow.phase === "station" && flow.station === 1 && (
          <Station2RealOrFake
            key={lang}
            clips={cases}
            lang={lang}
            track={track}
            onDone={(s, tot) => {
              setScore(s);
              setTotal(tot);
              go({ type: "advance" });
            }}
          />
        )}

        {flow.phase === "station" && flow.station === 2 && (
          <Station3Compression
            ladder={codecLadder}
            lang={lang}
            onDone={() => go({ type: "advance" })}
          />
        )}

        {flow.phase === "station" && flow.station === 3 && (
          <Station4Factory
            factory={manifest.manifest.fakeFactory}
            fallbackFakes={fakes}
            lang={lang}
            onDone={() => go({ type: "advance" })}
          />
        )}

        {flow.phase === "station" && flow.station === 4 && (
          <Station5Diploma
            score={score}
            total={total || 5}
            lang={lang}
            track={track}
            scamMessage={pickScamClip(manifest.manifest.fakeFactory, lang)}
            onScoreChange={setScore}
            onRestart={finishVisit}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The clip the closing scenario plays: a real generated fake of the "I lost my
 * phone, can you transfer money" message, in the interface language when the
 * pack has it. No new media, and nothing invented — it is the same voice the
 * visitor built one station earlier, and the quoted line is the sentence that
 * clip actually says rather than one written for the story.
 */
function pickScamClip(
  factory: FakeFactory | undefined,
  lang: Lang,
): { audio: string; text: string } | undefined {
  const scams = factory?.clips.filter((clip) => clip.scam) ?? [];
  const localised = scams.filter((clip) => (clip.lang ?? "nl") === lang);
  const chosen = localised[0] ?? scams[0];
  return chosen ? { audio: chosen.audio, text: chosen.text } : undefined;
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
  station: StationIndex;
  lang: Lang;
  onStart: () => void;
}) {
  const t = useT(lang);
  const who = station === 0 ? "miko" : "echo";
  const n = stationNumber(station);

  return (
    <StationCard>
      <div className="flex flex-col items-center gap-5 py-4 text-center sm:gap-6 sm:py-8">
        <p className="rise font-mono text-xs font-bold tracking-[0.24em] text-ink-400 uppercase tnum">
          {t("brief.mission", { n, total: STATION_COUNT })}
        </p>
        <Persona
          who={who}
          size={96}
          mood={who === "miko" ? "listening" : "idle"}
          className="pop breathe"
        />
        <h2
          className="rise max-w-3xl text-2xl font-black text-white sm:text-4xl md:text-5xl"
          style={{ animationDelay: "90ms" }}
        >
          {t(`brief.b${n}.title`)}
        </h2>
        <p
          className="rise max-w-2xl text-base font-semibold text-white/80 sm:text-lg md:text-xl"
          style={{ animationDelay: "180ms" }}
        >
          {t(`brief.b${n}.text`)}
        </p>
        <BigButton onClick={onStart} tone={who} className="halo mt-1">
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
      <div className="flex flex-col items-center gap-5 py-2 text-center sm:gap-6 sm:py-4">
        {/* The two of them, side by side, before a word is read: one round and
            open, one hard-edged and watchful. The whole premise in a silhouette.
            The stagger on the second breathe keeps them from bobbing in lockstep,
            which reads as a looping GIF rather than two characters. */}
        <div className="flex items-end gap-6 sm:gap-10">
          <Persona who="miko" size={100} mood="listening" className="breathe" />
          <Persona
            who="echo"
            size={116}
            className="breathe"
            style={{ animationDelay: "1.2s" }}
          />
        </div>

        {/* A sound wave between them and the title: this is a SOUND exhibit,
            and the motif should read before any copy does. Heights are a fixed
            pattern (not random) so server and client render identically. */}
        <div className="flex h-8 w-full max-w-[15rem] items-end justify-center gap-1" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={i}
              className="w-1 min-w-0 flex-1 rounded-full bg-echo-400/50"
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
          <h2 className="rise text-3xl font-black text-white sm:text-4xl md:text-6xl">
            {t("app.title")}
          </h2>
          <p
            className="rise text-base font-bold text-miko-300 sm:text-lg md:text-xl"
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
    <main className="grid min-h-screen place-items-center p-6 sm:p-8">{children}</main>
  );
}
