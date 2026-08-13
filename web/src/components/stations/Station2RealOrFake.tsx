"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, ClipLabel } from "@/components/manifest-types";
import {
  useAudio,
  useBeat,
  useT,
  type Lang,
  type TrackFn,
} from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import {
  AudioProblem,
  BigButton,
  PersonaBubble,
  PlayButton,
  Spectrogram,
  Stamp,
  StationCard,
} from "@/components/kiosk/ui";
import { isReportableError, playbackErrorKey } from "@/lib/audio-state";
import { buildRounds } from "@/lib/quiz";
import type { ClipStats } from "@/lib/stats";

const MAX_REPLAYS = 3;
/** Long enough to read Echo's line, short enough that nobody hunts for Play. */
const AUTOPLAY_DELAY_MS = 650;

/**
 * Station 2 — "Echt of Nep?", the heart of the demo.
 *
 * The teaching beat is deliberately AFTER the guess: you commit, you find out
 * you were fooled, and only then does Echo show you the evidence. Being wrong is
 * the lesson, so the reveal has to land like a verdict — hence the stamp.
 *
 * The verdict itself comes back from the server, which resolves the clip's
 * label from the validated manifest. The browser no longer asserts "I was
 * right"; it asks, and the same response carries the crowd aggregate, so the
 * "71% were fooled" line can no longer race the write that produced it.
 */
export function Station2RealOrFake({
  clips,
  lang,
  track,
  onDone,
}: {
  clips: Clip[];
  lang: Lang;
  track: TrackFn;
  onDone: (score: number, total: number) => void;
}) {
  const t = useT(lang);

  const [rounds] = useState<Clip[]>(() => buildRounds(clips));

  const [index, setIndex] = useState(0);
  const [guess, setGuess] = useState<ClipLabel | null>(null);
  const [correct, setCorrect] = useState(false);
  const [replays, setReplays] = useState(0);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<ClipStats | null>(null);
  const [finished, setFinished] = useState(false);

  const clip = rounds[index];
  const {
    ref: audioRef,
    play,
    playing,
    progress,
    error: audioError,
  } = useAudio(clip?.audio);

  /**
   * Which clip has already been started, by anyone. The autoplay timer and the
   * Listen button used to race: tapping Play inside the 650 ms window spent a
   * replay, then the timer fired, reset the counter to 1 and restarted the clip
   * from the top — the visitor's own tap silently cost them a listen and cut
   * off the audio they had just asked for.
   */
  const startedFor = useRef<string | null>(null);

  const startPlayback = useCallback(
    async (clipId: string) => {
      startedFor.current = clipId;
      setReplays((r) => r + 1);
      await play();
    },
    [play],
  );

  const listen = useCallback(() => {
    if (!clip || replays >= MAX_REPLAYS || guess !== null) return;
    void startPlayback(clip.id);
  }, [clip, replays, guess, startPlayback]);

  // Auto-play each new case so a child never has to hunt for the play button —
  // but nothing depends on it succeeding. If the browser blocks it, the Listen
  // button is right there and the failure says so out loud.
  useEffect(() => {
    if (!clip) return;
    const clipId = clip.id;
    const timer = setTimeout(() => {
      if (startedFor.current === clipId) return;
      void startPlayback(clipId);
    }, AUTOPLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [clip, startPlayback]);

  const commit = useCallback(
    async (choice: ClipLabel) => {
      if (guess !== null || !clip) return;
      setGuess(choice);

      const response = await track({
        station: 2,
        type: "guess",
        clipId: clip.id,
        guess: choice,
      });

      // The server's verdict when it answered; the manifest the browser already
      // holds when it did not. Both read the same pack — the difference is only
      // that one of them is the copy the counters are built from.
      const isRight = response?.guess?.correct ?? choice === clip.label;
      setCorrect(isRight);
      if (isRight) setScore((s) => s + 1);
      setStats(response?.clipStats ?? null);
      announce(
        `${t(isRight ? "station2.solved" : "station2.fooled")} ${t(
          clip.label === "real" ? "station2.itWasReal" : "station2.itWasFake",
        )}`,
        "assertive",
      );
    },
    [guess, clip, track, t],
  );

  // After the last case: show the score screen INSIDE the station. The button
  // used to say "see your score" and then jump straight to the next briefing —
  // the score the visitor just earned never appeared anywhere.
  const next = useCallback(() => {
    if (index + 1 >= rounds.length) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setGuess(null);
    setCorrect(false);
    setReplays(0);
    setStats(null);
  }, [index, rounds.length]);

  useEffect(() => {
    if (!clip || guess !== null) return;
    announce(t("station2.caseCounter", { n: index + 1, total: rounds.length }));
  }, [clip, guess, index, rounds.length, t]);

  if (!clip) return null;

  if (finished) {
    const commentKey =
      score >= 4
        ? "station2.scoreHigh"
        : score >= 2
          ? "station2.scoreMid"
          : "station2.scoreLow";
    return (
      <StationCard>
        <div className="flex flex-col items-center gap-4 py-4 text-center sm:py-6">
          <p className="rise font-mono text-xs font-bold tracking-[0.24em] text-ink-400 uppercase">
            {t("station2.scoreKicker")}
          </p>
          <p
            className="rise font-display text-6xl font-black text-white tnum sm:text-7xl md:text-8xl"
            style={{ animationDelay: "90ms" }}
          >
            {score}/{rounds.length}
          </p>
          <p
            className="rise text-lg font-bold text-ink-400 sm:text-xl"
            style={{ animationDelay: "170ms" }}
          >
            {t("station5.score", { score, total: rounds.length })}
          </p>
        </div>
        <PersonaBubble who="echo" delayMs={350}>
          {t(commentKey)}
        </PersonaBubble>

        {/* The counterexample, stated before anyone leaves with a rule of thumb
            that will fail them. Everything Echo pointed at is a hint about how
            these particular clips were made — not a test that works on the next
            voice message a visitor receives. */}
        <div className="rise rounded-[20px] bg-miko-500/10 p-4 ring-1 ring-miko-500/40 ring-inset sm:p-5">
          <p className="mb-1 font-mono text-[11px] font-bold tracking-[0.16em] text-miko-400 uppercase">
            {t("station2.uncertaintyTitle")}
          </p>
          <p className="text-sm leading-relaxed font-bold text-white/85 sm:text-base">
            {t("station2.uncertainty")}
          </p>
        </div>

        <div className="flex justify-end">
          <BigButton onClick={() => onDone(score, rounds.length)} tone="echo">
            {t("station2.toMission3")}
          </BigButton>
        </div>
      </StationCard>
    );
  }

  const playbackError = isReportableError(audioError) ? audioError : null;

  return (
    <StationCard>
      <audio ref={audioRef} src={clip.audio} preload="auto" />

      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-ink-800 px-3 py-2 font-mono text-[11px] font-bold tracking-[0.16em] text-echo-300 uppercase tnum sm:px-4 sm:text-xs">
          {t("station2.caseCounter", { n: index + 1, total: rounds.length })}
        </span>
        <span
          className="flex items-center gap-1.5"
          role="img"
          aria-label={t("station2.replaysLeft", {
            n: Math.max(0, MAX_REPLAYS - replays),
          })}
        >
          {Array.from({ length: MAX_REPLAYS }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-2.5 w-2.5 rounded-full transition-colors duration-200 ${
                i < MAX_REPLAYS - replays ? "bg-miko-400" : "bg-ink-700"
              }`}
            />
          ))}
        </span>
      </header>

      {guess === null ? (
        <>
          {/* Echo's briefing escalates with the rounds — the rounds ARE ordered
              by difficulty, so the story he tells is true. Keyed so each new
              case re-enters instead of silently swapping text. */}
          <PersonaBubble key={index} who="echo" mood="listening">
            {t(`station2.prompt${index + 1}`)}
          </PersonaBubble>

          {playbackError && (
            <AudioProblem
              lang={lang}
              message={t(playbackErrorKey(playbackError))}
              onRetry={() => void startPlayback(clip.id)}
              retryLabel={t("audio.retry")}
            />
          )}

          {/* The visitor gets the SAME evidence Echo uses, before guessing —
              the spectrogram, minus the clue box (that would give it away).
              Echo's reveal always shows the picture afterwards; letting people
              study it beforehand turns round five into an actual skill check. */}
          <Spectrogram
            image={clip.spectrogram.image}
            playhead={playing ? progress : undefined}
            className="h-32 w-full sm:h-40"
            caption={t("station2.lookListen")}
            alt={t("station2.specAlt")}
            missingLabel={t("audio.missingImage")}
          />
          <div className="flex justify-center">
            <PlayButton
              onClick={listen}
              playing={playing}
              disabled={replays >= MAX_REPLAYS}
              label={
                replays >= MAX_REPLAYS ? t("station2.noReplays") : t("common.listen")
              }
            />
          </div>

          <div
            className="rise grid grid-cols-2 gap-3 sm:gap-5"
            style={{ animationDelay: "120ms" }}
          >
            <BigButton
              tone="real"
              onClick={() => void commit("real")}
              className="py-6 sm:py-9"
            >
              {t("common.real")}
            </BigButton>
            <BigButton
              tone="fake"
              onClick={() => void commit("fake")}
              className="py-6 sm:py-9"
            >
              {t("common.fake")}
            </BigButton>
          </div>
        </>
      ) : (
        <Reveal
          key={clip.id}
          clip={clip}
          correct={correct}
          stats={stats}
          lang={lang}
          round={index}
          isLast={index + 1 >= rounds.length}
          onNext={next}
        />
      )}
    </StationCard>
  );
}

/**
 * The teaching beat, in strict order: the verdict lands first and alone, then
 * the truth (plus the crowd stat), and only THEN does Echo walk in with the
 * evidence. Dumping all of it on screen at once — as this used to — buries the
 * emotional beat ("I was fooled") under the explanation of why.
 */
function Reveal({
  clip,
  correct,
  stats,
  lang,
  round,
  isLast,
  onNext,
}: {
  clip: Clip;
  correct: boolean;
  stats: ClipStats | null;
  lang: Lang;
  round: number;
  isLast: boolean;
  onNext: () => void;
}) {
  const t = useT(lang);
  const beat = useBeat([700, 1500, 2400]);

  // A real clip has no forensic "tell" to circle — Echo instead points out the
  // messy human bits (breaths, room tone) these particular fakes lack. Three
  // phrasings rotate by round so a run with several real cases doesn't repeat.
  const realKeys = [
    "station2.realExplanation",
    "station2.realExplanationB",
    "station2.realExplanationC",
  ];
  const explanation = clip.clue
    ? t(clip.clue.key)
    : t(realKeys[round % realKeys.length]);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col items-center gap-3">
        <Stamp
          correct={correct}
          text={correct ? t("station2.solved") : t("station2.fooled")}
        />
        {/* The stat slot keeps its height whether or not the numbers arrive, so
            a slow response can't shove the evidence around mid-read. */}
        <div className="flex min-h-[4.5rem] flex-col items-center gap-2 text-center">
          {beat >= 1 && (
            <p className="rise text-base font-bold text-white/85 sm:text-lg">
              {t(clip.label === "real" ? "station2.itWasReal" : "station2.itWasFake")}
            </p>
          )}
          {beat >= 1 && stats && stats.fooledPct !== null && (
            <p className="rise rounded-full bg-ink-800 px-4 py-1.5 text-sm font-bold text-miko-300 tnum sm:px-5 sm:text-base">
              {t("station2.fooledStat", { pct: stats.fooledPct })}
            </p>
          )}
        </div>
      </div>

      {beat >= 2 && (
        <>
          <PersonaBubble who="echo" mood={clip.clue ? "alert" : "idle"}>
            {explanation}
          </PersonaBubble>

          <Spectrogram
            image={clip.spectrogram.image}
            clue={clip.clue}
            showClue={Boolean(clip.clue)}
            scanning
            className="h-40 w-full sm:h-56"
            caption={t("station2.evidence")}
            alt={t("station2.specAlt")}
            missingLabel={t("audio.missingImage")}
            /* The same evidence in words, for anyone who cannot see the box or
               hear the clip it points at. Only after the guess is committed. */
            clueDescription={explanation}
          />

          {/* Two sentences that keep this station honest. The first: a clue is
              not proof — the newest fakes add breath and room noise, and plenty
              of genuine recordings sound implausibly clean. The second: Echo is
              not analysing anything. He is reading labels that were prepared
              offline with the samples. Letting a child leave believing a
              detective AI just listened would be the worst thing this demo
              could teach. */}
          <p className="text-xs leading-relaxed text-ink-400 sm:text-sm">
            {t("station2.clueCaveat")}
          </p>
          <p className="text-xs leading-relaxed text-ink-400 sm:text-sm">
            {t("station2.echoDisclosure")}
          </p>
        </>
      )}

      <div className="flex min-h-[4.75rem] justify-end">
        {beat >= 3 && (
          <BigButton onClick={onNext} tone="echo" className="rise">
            {isLast ? t("station2.toScore") : t("station2.nextCase")}
          </BigButton>
        )}
      </div>
    </div>
  );
}
