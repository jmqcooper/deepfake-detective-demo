"use client";

import { useCallback, useEffect, useState } from "react";
import type { Clip, ClipLabel } from "@/components/manifest-types";
import {
  useAudio,
  useBeat,
  useT,
  type DemoEventInput,
  type Lang,
} from "@/components/kiosk/hooks";
import {
  BigButton,
  PersonaBubble,
  PlayButton,
  Spectrogram,
  Stamp,
  StationCard,
} from "@/components/kiosk/ui";

const MAX_REPLAYS = 3;

interface ClipStats {
  guesses: number;
  fooledPct: number | null;
}

/**
 * Station 2 — "Echt of Nep?", the heart of the demo.
 *
 * The teaching beat is deliberately AFTER the guess: you commit, you find out
 * you were fooled, and only then does Echo show you the evidence. Being wrong is
 * the lesson, so the reveal has to land like a verdict — hence the stamp.
 */
export function Station2RealOrFake({
  clips,
  lang,
  track,
  onDone,
}: {
  clips: Clip[];
  lang: Lang;
  track: (e: DemoEventInput) => void;
  onDone: (score: number, total: number) => void;
}) {
  const t = useT(lang);

  /**
   * Five rounds of ascending difficulty — one clip drawn per difficulty tier.
   *
   * Two things must hold at once, and both are easy to get wrong:
   *
   * 1. The answers must be unguessable. The manifest lists the pool strictly
   *    real/fake/real/fake, so simply playing it in order lets a sharp
   *    nine-year-old crack the pattern by round three and stop listening.
   * 2. Every run must contain BOTH real and fake clips. Drawing each tier
   *    independently at random can deal five reals in a row — the visitor answers
   *    "echt" five times, scores 5/5, and learns nothing. (Not hypothetical: a
   *    test run did exactly that.)
   *
   * So we fix the NUMBER of fakes (2 or 3 of 5) and randomise WHICH tiers they
   * land in. The mix is guaranteed; the order stays unpredictable.
   */
  const [rounds] = useState<Clip[]>(() => {
    const tiers = [...new Set(clips.map((c) => c.difficulty))].sort(
      (a, b) => a - b,
    );
    const fakeCount = 2 + Math.floor(Math.random() * 2);
    const fakeTiers = new Set(
      [...tiers].sort(() => Math.random() - 0.5).slice(0, fakeCount),
    );

    return tiers.flatMap((tier) => {
      const want: ClipLabel = fakeTiers.has(tier) ? "fake" : "real";
      const pool = clips.filter((c) => c.difficulty === tier && c.label === want);
      const chosen = pool.length
        ? pool
        : clips.filter((c) => c.difficulty === tier);
      return chosen.length
        ? [chosen[Math.floor(Math.random() * chosen.length)]]
        : [];
    });
  });

  const [index, setIndex] = useState(0);
  const [guess, setGuess] = useState<ClipLabel | null>(null);
  const [replays, setReplays] = useState(0);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<ClipStats | null>(null);
  const [finished, setFinished] = useState(false);

  const clip = rounds[index];
  const { ref, play, playing, progress } = useAudio(clip?.audio);
  const correct = guess !== null && guess === clip?.label;

  const listen = useCallback(() => {
    if (replays >= MAX_REPLAYS || guess !== null) return;
    setReplays((r) => r + 1);
    play();
  }, [replays, guess, play]);

  const commit = useCallback(
    (choice: ClipLabel) => {
      if (guess !== null || !clip) return;
      setGuess(choice);
      const isRight = choice === clip.label;
      if (isRight) setScore((s) => s + 1);
      track({
        station: 2,
        type: "guess",
        clipId: clip.id,
        guess: choice,
        correct: isRight,
      });

      // "71% of visitors were fooled by this one" — the best line in the reveal,
      // and the whole reason the events endpoint exists. Missing stats are fine.
      fetch(`/api/stats/clip/${encodeURIComponent(clip.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((s: ClipStats | null) => setStats(s))
        .catch(() => setStats(null));
    },
    [guess, clip, track],
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
    setReplays(0);
    setStats(null);
  }, [index, rounds.length]);

  // Auto-play each new case so a child never has to hunt for the play button.
  useEffect(() => {
    if (!clip) return;
    const timer = setTimeout(() => {
      setReplays(1);
      play();
    }, 650);
    return () => clearTimeout(timer);
  }, [clip, play]);

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
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="rise font-mono text-xs font-bold tracking-[0.24em] text-ink-400 uppercase">
            {t("station2.scoreKicker")}
          </p>
          <p
            className="rise font-display text-7xl font-black text-white tnum md:text-8xl"
            style={{ animationDelay: "90ms" }}
          >
            {score}/{rounds.length}
          </p>
          <p
            className="rise text-xl font-bold text-ink-400"
            style={{ animationDelay: "170ms" }}
          >
            {t("station5.score", { score, total: rounds.length })}
          </p>
        </div>
        <PersonaBubble who="echo" delayMs={350}>
          {t(commentKey)}
        </PersonaBubble>
        <div className="flex justify-end">
          <BigButton onClick={() => onDone(score, rounds.length)} tone="echo">
            {t("station2.toMission3")}
          </BigButton>
        </div>
      </StationCard>
    );
  }

  return (
    <StationCard>
      <audio ref={ref} src={clip.audio} preload="auto" />

      <header className="flex items-center justify-between">
        <span className="rounded-full bg-ink-800 px-4 py-2 font-mono text-xs font-bold tracking-[0.16em] text-echo-300 uppercase tnum">
          {t("station2.caseCounter", { n: index + 1, total: rounds.length })}
        </span>
        <span className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: MAX_REPLAYS }, (_, i) => (
            <span
              key={i}
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

          {/* The visitor gets the SAME evidence Echo uses, before guessing —
              the spectrogram, minus the clue box (that would give it away).
              Echo's reveal always shows the picture afterwards; letting people
              study it beforehand turns round five into an actual skill check. */}
          <Spectrogram
            image={clip.spectrogram.image}
            playhead={playing ? progress : undefined}
            className="h-40 w-full"
            caption={t("station2.lookListen")}
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
            className="rise grid grid-cols-2 gap-5"
            style={{ animationDelay: "120ms" }}
          >
            <BigButton tone="real" onClick={() => commit("real")} className="py-9">
              {t("common.real")}
            </BigButton>
            <BigButton tone="fake" onClick={() => commit("fake")} className="py-9">
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
  // messy human bits (breaths, room tone) that the fakes lack. Three phrasings
  // rotate by round, so a run with several real cases doesn't repeat itself.
  const realKeys = [
    "station2.realExplanation",
    "station2.realExplanationB",
    "station2.realExplanationC",
  ];
  const explanation = clip.clue
    ? t(clip.clue.key)
    : t(realKeys[round % realKeys.length]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3">
        <Stamp
          correct={correct}
          text={correct ? t("station2.solved") : t("station2.fooled")}
        />
        {/* The stat slot keeps its height whether or not the numbers arrive, so
            a slow /api/stats response can't shove the evidence around mid-read. */}
        <div className="flex min-h-[4.5rem] flex-col items-center gap-2">
          {beat >= 1 && (
            <p className="rise text-lg font-bold text-white/85">
              {t(clip.label === "real" ? "station2.itWasReal" : "station2.itWasFake")}
            </p>
          )}
          {beat >= 1 && stats && stats.fooledPct !== null && (
            <p className="rise rounded-full bg-ink-800 px-5 py-1.5 text-base font-bold text-miko-300 tnum">
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
            className="h-56 w-full"
            caption={t("station2.evidence")}
          />
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
