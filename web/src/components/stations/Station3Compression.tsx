"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodecRung } from "@/components/manifest-types";
import { useT, type Lang } from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import {
  BigButton,
  Panel,
  Persona,
  PersonaBubble,
  SampleImage,
  StationCard,
} from "@/components/kiosk/ui";
import {
  IconChat,
  IconPhone,
  IconRadio,
  IconStudio,
} from "@/components/kiosk/icons";
import {
  ladderOutcome,
  predictionWasRight,
  rungAudio,
  rungSpectrogram,
  rungTranscript,
  type LadderPrediction,
} from "@/lib/codec-ladder";

/**
 * Station 3 — "De compressie-machine".
 *
 * One utterance, four quality rungs. The station is a guided TOUR: the machine
 * plays the sentence once at studio quality, then automatically steps down a
 * rung each time the clip ends, so the visitor hears the degradation as a
 * story rather than fiddling a lever mid-loop. After the tour (or as soon as
 * the visitor taps a rung themselves) it becomes free play: tap a rung, hear
 * that quality exactly once. Nothing ever loops forever — museum halls do not
 * need a fifth hour of "Hallo! Kom je vanmiddag…".
 *
 * The payoff is a prediction rather than a prewritten claim. Before the
 * machine starts, the visitor commits: will the recogniser still manage at the
 * worst setting? Then they hear all four and the answer is read straight off
 * the transcripts the pipeline captured from the real ASR. Being wrong here is
 * the point — almost everybody expects the words to fall apart with the sound.
 */
export function Station3Compression({
  ladder,
  lang,
  onDone,
}: {
  ladder: CodecRung[];
  lang: Lang;
  onDone: () => void;
}) {
  const t = useT(lang);
  const [level, setLevel] = useState(0);
  const [prediction, setPrediction] = useState<LadderPrediction | null>(null);
  const [started, setStarted] = useState(false);
  const [playingLevel, setPlayingLevel] = useState<number | null>(null);
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [failed, setFailed] = useState(false);
  const refs = useRef<(HTMLAudioElement | null)[]>([]);
  const tourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tour mode auto-advances on `ended`; a visitor's tap switches to free play.
  const mode = useRef<"tour" | "free">("tour");

  const rung = ladder[level];
  // 0 at studio → 1 at the worst rung: how much evidence has been destroyed.
  const damage = ladder.length > 1 ? level / (ladder.length - 1) : 0;

  const outcome = useMemo(() => ladderOutcome(ladder, lang), [ladder, lang]);
  const spectrogram = rung ? rungSpectrogram(rung, lang) : "";
  const transcript = rung ? rungTranscript(rung, lang) : undefined;

  const playRung = useCallback(
    (i: number) => {
      refs.current.forEach((el, j) => {
        if (!el) return;
        if (j === i) {
          el.currentTime = 0;
          void el
            .play()
            .then(() => setFailed(false))
            .catch((reason: unknown) => {
              // A rung that will not play must not silently count as "heard".
              // An AbortError only means a newer rung interrupted this one.
              const name =
                reason instanceof DOMException ? reason.name : "";
              if (name === "AbortError") return;
              setFailed(true);
              setPlayingLevel((p) => (p === i ? null : p));
            });
        } else {
          el.pause();
        }
      });
      setLevel(i);
      setPlayingLevel(i);
      if (ladder[i]) announce(t(ladder[i].labelKey));
    },
    [ladder, t],
  );

  const start = (choice: LadderPrediction) => {
    if (tourTimer.current) clearTimeout(tourTimer.current);
    setPrediction(choice);
    setStarted(true);
    mode.current = "tour";
    playRung(0);
  };

  const choose = (next: number) => {
    // A tap takes over from the tour: from here on, one play per tap.
    if (tourTimer.current) clearTimeout(tourTimer.current);
    mode.current = "free";
    playRung(next);
  };

  // The tour: when a rung finishes, step down to the next one.
  const onEnded = useCallback(
    (i: number) => {
      setPlayingLevel((p) => (p === i ? null : p));
      setVisited((v) => new Set(v).add(i));
      if (mode.current !== "tour") return;
      if (i + 1 < ladder.length) {
        // Brief breath between rungs so each level registers as its own beat.
        tourTimer.current = setTimeout(() => {
          if (mode.current === "tour") playRung(i + 1);
        }, 700);
      } else {
        mode.current = "free";
      }
    },
    [ladder.length, playRung],
  );

  useEffect(
    () => () => {
      mode.current = "free";
      if (tourTimer.current) clearTimeout(tourTimer.current);
      refs.current.forEach((el) => el?.pause());
    },
    [],
  );

  const exploredAll = visited.size >= ladder.length;

  if (!rung) return null;

  return (
    <StationCard>
      {ladder.map((r, i) => (
        <audio
          key={`${r.id}-${lang}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          src={rungAudio(r, lang)}
          preload="auto"
          onEnded={() => onEnded(i)}
          onError={() => {
            setFailed(true);
            setPlayingLevel((current) => (current === i ? null : current));
          }}
        />
      ))}

      {/* Echo's briefing stays put while the machine runs its tour; the
          conclusion arrives as its own panel below once all rungs are heard. */}
      <PersonaBubble who="echo">{t("station3.echoIntro")}</PersonaBubble>

      {!started ? (
        <Panel className="grid min-h-[16rem] place-items-center p-5 sm:min-h-[22rem]">
          <div className="flex max-w-xl flex-col items-center gap-5 text-center">
            <p className="text-lg font-black text-white sm:text-xl">
              {t("station3.predictTitle")}
            </p>
            <p className="text-sm font-semibold text-white/75 sm:text-base">
              {t("station3.predictBody")}
            </p>
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
              <BigButton onClick={() => start("understands")} tone="miko">
                {t("station3.predictYes")}
              </BigButton>
              <BigButton onClick={() => start("fails")} tone="fake">
                {t("station3.predictNo")}
              </BigButton>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-[1fr_auto]">
          <div className="relative min-w-0 overflow-hidden rounded-[18px] bg-ink-950 ring-1 ring-white/10 ring-inset">
            <SampleImage
              src={spectrogram}
              alt={t("station3.specAlt", { level: t(rung.labelKey) })}
              className="block h-48 w-full object-fill sm:h-72"
              fallbackLabel={t("audio.missingImage")}
            />

            {/* The clue zone: the high band where the tell-tale artefacts live.
                It literally gets shuttered away as you compress. */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[38%] border-b-2 border-dashed transition-[background-color,border-color,backdrop-filter] duration-500"
              style={{
                borderColor: `rgba(255,196,92,${1 - damage * 0.85})`,
                background: `rgba(5,7,15,${damage * 0.74})`,
                backdropFilter: damage > 0.2 ? `grayscale(${damage})` : undefined,
              }}
            >
              <span
                className="absolute top-2 left-3 rounded-md px-2 py-1 font-mono text-[10px] font-bold tracking-[0.14em] uppercase transition-colors duration-300"
                style={{
                  color: damage > 0.5 ? "rgba(255,255,255,0.45)" : "#ffc45c",
                }}
              >
                {damage > 0.5
                  ? t("station3.clueZoneGone")
                  : t("station3.clueZone")}
              </span>
            </div>

            <span className="absolute bottom-3 left-3 rounded-lg bg-ink-950/80 px-3 py-1.5 font-mono text-xs font-bold tracking-wide text-white tnum">
              {t(rung.labelKey)}
              {rung.bitrateKbps ? ` · ${rung.bitrateKbps} kbit/s` : ""}
            </span>
          </div>

          <Lever
            ladder={ladder}
            level={level}
            playingLevel={playingLevel}
            onChange={choose}
            label={(r) => t(r.labelKey)}
            groupLabel={t("station3.leverLabel")}
          />
        </div>
      )}

      {started && failed && (
        <p
          className="rounded-[20px] bg-fake-500/10 p-4 text-sm font-bold text-fake-400 ring-1 ring-fake-500/40 ring-inset"
          role="alert"
        >
          {t("audio.error.unknownRung")}
        </p>
      )}

      {/* Miko's own transcript at this quality. If the ASR hears nothing, the
          pipeline supplies an explicit no-speech marker rather than hiding the
          panel or leaving provenance ambiguous. */}
      {started && transcript !== undefined && (
        <Panel className="flex items-center gap-4 p-4">
          <Persona
            who="miko"
            size={52}
            mood={playingLevel !== null ? "listening" : "idle"}
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="mb-0.5 font-mono text-[10px] font-bold tracking-[0.16em] text-miko-400 uppercase">
              {t("station3.mikoHears")}
            </p>
            {transcript ? (
              <p className="text-base font-bold text-white/85 sm:text-lg">
                “{transcript}”
              </p>
            ) : (
              <p className="text-base font-bold text-fake-400 italic sm:text-lg">
                {t("station3.mikoHearsNothing")}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* The case-closed moment: once all four rungs have been heard, the
          prediction is settled against the transcripts the pipeline actually
          captured, and Echo delivers the verdict of this station. */}
      {started && exploredAll && outcome && prediction && (
        <div className="rise flex flex-col gap-4">
          <div className="rounded-[20px] bg-ink-800/70 p-4 ring-1 ring-white/[0.06] ring-inset sm:p-5">
            <p className="mb-1 font-mono text-[11px] font-bold tracking-[0.16em] text-miko-400 uppercase">
              {t(
                predictionWasRight(prediction, outcome)
                  ? "station3.predictRight"
                  : "station3.predictWrong",
              )}
            </p>
            <p className="text-sm leading-relaxed font-bold text-white/85 sm:text-base">
              {t(
                outcome.identical
                  ? "station3.resultIdentical"
                  : outcome.producedWords
                    ? "station3.resultChanged"
                    : "station3.resultSilent",
              )}
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="min-w-0 rounded-[14px] bg-ink-950/50 p-3">
                <dt className="font-mono text-[10px] tracking-[0.16em] text-ink-400 uppercase">
                  {t("codec.studio")}
                </dt>
                <dd className="mt-1 font-bold text-white/85">
                  “{outcome.studioTranscript}”
                </dd>
              </div>
              <div className="min-w-0 rounded-[14px] bg-ink-950/50 p-3">
                <dt className="font-mono text-[10px] tracking-[0.16em] text-ink-400 uppercase">
                  {t("codec.terrible")}
                </dt>
                <dd className="mt-1 font-bold text-white/85">
                  {outcome.worstTranscript
                    ? `“${outcome.worstTranscript}”`
                    : t("station3.mikoHearsNothing")}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex items-center gap-4 rounded-[20px] bg-echo-500/10 p-4 ring-1 ring-echo-500/40 ring-inset sm:p-5">
            <Persona who="echo" size={56} mood="alert" className="hidden shrink-0 sm:block" />
            <div className="min-w-0">
              <p className="mb-1 font-mono text-[11px] font-bold tracking-[0.16em] text-echo-300 uppercase">
                {t("station3.conclusion")}
              </p>
              <p className="text-base font-bold text-white/90 sm:text-lg">
                {t("station3.echoAfter")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <BigButton onClick={onDone} tone="echo" disabled={started && !exploredAll}>
          {!started || exploredAll ? t("common.next") : t("station3.tryAll")}
        </BigButton>
      </div>
    </StationCard>
  );
}

const RUNG_ICONS = [IconStudio, IconPhone, IconChat, IconRadio];

function Lever({
  ladder,
  level,
  playingLevel,
  onChange,
  label,
  groupLabel,
}: {
  ladder: CodecRung[];
  level: number;
  playingLevel: number | null;
  onChange: (i: number) => void;
  label: (r: CodecRung) => string;
  groupLabel: string;
}) {
  return (
    /* Outer r=20 with p-3 (12) → children r=8... but the rungs read better as
       chunky targets, so: outer r=24, p-3, children r=16 (16 + 8 = 24). */
    <div
      className="flex min-w-0 flex-col justify-between gap-2 rounded-[24px] bg-ink-950/60 p-3 ring-1 ring-white/[0.06] ring-inset"
      role="group"
      aria-label={groupLabel}
    >
      {ladder.map((r, i) => {
        const active = i === level;
        const Icon = RUNG_ICONS[i] ?? IconStudio;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(i)}
            aria-pressed={active}
            className={`flex min-h-14 w-full min-w-0 items-center gap-3 rounded-[16px] px-3 py-3 text-left text-base font-extrabold transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] sm:px-4 sm:text-lg md:min-w-52 ${
              active
                ? "bg-echo-400 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_10px_24px_-10px_rgba(53,214,199,0.7)]"
                : "text-ink-400 hover:bg-ink-800 hover:text-white"
            }`}
          >
            <span className="shrink-0">
              <Icon />
            </span>
            <span className="min-w-0 flex-1 truncate">{label(r)}</span>
            {playingLevel === i && (
              <span className="flex h-4 shrink-0 items-center gap-[2px]" aria-hidden>
                {[0, 1, 2].map((b) => (
                  <span
                    key={b}
                    className="w-[3px] rounded-full bg-current"
                    style={{
                      height: "100%",
                      transformOrigin: "center",
                      animation: `bar ${0.5 + b * 0.14}s ease-in-out ${b * 0.08}s infinite`,
                    }}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
