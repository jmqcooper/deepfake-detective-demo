"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Clip } from "@/components/manifest-types";
import {
  useAudio,
  useElementWidth,
  useT,
  type Lang,
} from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import {
  AudioProblem,
  BigButton,
  Panel,
  PersonaBubble,
  PlayButton,
  Spectrogram,
  StationCard,
  Typewriter,
} from "@/components/kiosk/ui";
import { isReportableError, playbackErrorKey } from "@/lib/audio-state";
import {
  barCountFor,
  decodePeaks,
  loudestFraction,
  peakVerdict,
  resamplePeaks,
} from "@/lib/waveform";

type Stage = 0 | 1 | 2 | 3;
const STAGES: Stage[] = [0, 1, 2, 3];

/**
 * Station 1 — "In het brein van de spraak-AI".
 *
 * Walks the visitor through four useful beats between a sound and a word:
 * vibrations → a picture of the sound → guessed chunks → text. The last stage
 * is the one that matters: Miko *guesses*, and guesses can be wrong.
 *
 * Everything on screen is driven by the audio playhead, not by free-running
 * timers. The old version typed and flickered on its own clock, so the text
 * regularly finished before the clip had said the words — the exact
 * "he wrote it before he heard it" mismatch this station exists to explain.
 *
 * Stage 1 is a real prediction: point at the loudest moment, then find out.
 * The answer is measured from the decoded audio in the browser — it is the
 * same array of peaks the waveform is drawn from, so nothing here is a claim
 * about what a model thinks, only about what the sound actually did.
 */
export function Station1Brain({
  clip,
  lang,
  onDone,
}: {
  clip: Clip;
  lang: Lang;
  onDone: () => void;
}) {
  const t = useT(lang);
  const [stage, setStage] = useState<Stage>(0);
  const [handoff, setHandoff] = useState(false);
  const audio = useAudio(clip.audio);
  const { ref, play, seek, playing, progress } = audio;
  const [peaks, setPeaks] = useState<number[] | null>(null);

  // The prediction loop for stage 1.
  const [pointer, setPointer] = useState<number | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);

  /**
   * The playhead's high-water mark for the current stage. Chunks settle against
   * THIS, not the raw playhead: a replay rewinds `progress` to 0, and the
   * already-settled words must stay settled instead of dissolving back to "…".
   */
  const [reach, setReach] = useState(0);
  const visibleReach = Math.max(reach, progress);

  const replay = useCallback(() => {
    // Preserve words that already settled before play() rewinds the element.
    setReach((current) => Math.max(current, progress));
    void play();
  }, [play, progress]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const decoded = await decodePeaks(clip.audio, 512);
      if (!cancelled) setPeaks(decoded);
    })();
    return () => {
      cancelled = true;
    };
  }, [clip.audio]);

  const answer = useMemo(() => (peaks ? loudestFraction(peaks) : null), [peaks]);

  const words = (clip.transcript ?? "").split(/\s+/).filter(Boolean);

  const advance = useCallback(() => {
    if (stage < 3) {
      const next = (stage + 1) as Stage;
      setStage(next);
      setReach(0);
      announce(t(`station1.stage${next}.miko`));
      void play();
    } else {
      onDone();
    }
  }, [stage, play, onDone, t]);

  const scrub = useCallback(
    (fraction: number) => {
      setPointer(fraction);
      void seek(fraction);
    },
    [seek],
  );

  const commitGuess = useCallback(() => {
    if (pointer === null || answer === null) return;
    setCommitted(pointer);
    const verdict = peakVerdict(pointer, answer);
    announce(
      t(verdict.close ? "station1.peakClose" : "station1.peakFar", {
        pct: Math.round(answer * 100),
      }),
      "assertive",
    );
    void seek(answer);
  }, [pointer, answer, seek, t]);

  const bubbleText =
    stage === 3 && handoff
      ? t("station1.handoff")
      : stage === 1 && committed !== null && answer !== null
        ? t(
            peakVerdict(committed, answer).close
              ? "station1.peakClose"
              : "station1.peakFar",
            { pct: Math.round(answer * 100) },
          )
        : t(`station1.stage${stage}.miko`);

  const playbackError = isReportableError(audio.error) ? audio.error : null;

  return (
    <StationCard>
      <audio ref={ref} src={clip.audio} preload="auto" />

      {/* Keyed on its text so each new line re-enters instead of snapping. */}
      <PersonaBubble
        key={bubbleText}
        who="miko"
        mood={playing ? "listening" : handoff && stage === 3 ? "happy" : "idle"}
      >
        {bubbleText}
      </PersonaBubble>

      <ol className="flex items-center gap-2" aria-label={t("station1.stepsLabel")}>
        {STAGES.map((s) => (
          <li
            key={s}
            aria-current={s === stage ? "step" : undefined}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              s <= stage ? "bg-miko-400" : "bg-ink-700"
            }`}
          >
            <span className="sr-only">
              {t("station1.stepOf", { n: s + 1, total: STAGES.length })}
            </span>
          </li>
        ))}
      </ol>

      {playbackError && (
        <AudioProblem
          lang={lang}
          message={t(playbackErrorKey(playbackError))}
          onRetry={replay}
          retryLabel={t("audio.retry")}
        />
      )}

      <Panel className="grid min-h-[16rem] place-items-center p-4 sm:min-h-[19rem] sm:p-6">
        {stage === 0 && <Waveform peaks={peaks} progress={progress} label={t("station1.waveLabel")} />}

        {(stage === 1 || stage === 2 || stage === 3) && (
          <div className="w-full min-w-0">
            <Spectrogram
              image={clip.spectrogram.image}
              className="h-40 w-full sm:h-56"
              playhead={playing ? progress : undefined}
              onScrub={stage === 1 ? scrub : undefined}
              scrubLabel={t("station1.scrubLabel")}
              scrubHint={stage === 1 ? t("station1.scrubHint") : undefined}
              caption={t("station1.specLabel")}
              alt={t("station1.specAlt")}
              missingLabel={t("audio.missingImage")}
              markers={
                stage === 1 && committed !== null && answer !== null
                  ? [
                      { fraction: committed, tone: "guess", label: t("station1.yourGuess") },
                      { fraction: answer, tone: "answer", label: t("station1.trueLoudest") },
                    ]
                  : undefined
              }
            />

            {stage === 1 && (
              <PeakPrediction
                lang={lang}
                pointer={pointer}
                committed={committed}
                answer={answer}
                onCommit={commitGuess}
              />
            )}

            {stage === 2 && <ChunkGuesses words={words} reach={visibleReach} />}

            {stage === 3 && (
              <p className="rise mt-5 rounded-[20px] bg-ink-800 px-4 py-4 text-center text-lg font-bold text-miko-300 sm:px-6 sm:text-2xl md:text-3xl">
                “
                <Typewriter
                  key={clip.id}
                  text={clip.transcript || t("station1.noTranscript")}
                  totalMs={(audio.durationSec ?? clip.durationSec) * 1000}
                  onDone={() => setHandoff(true)}
                />
                ”
              </p>
            )}
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <PlayButton
          onClick={replay}
          playing={playing}
          tone="miko"
          label={t("common.listen")}
        />
        <BigButton onClick={advance} tone="echo">
          {stage < 3 ? t("common.next") : t("station1.toStation2")}
        </BigButton>
      </div>
    </StationCard>
  );
}

/**
 * Point first, find out second. The visitor commits to a spot before the
 * answer exists on screen — a "here it is!" reveal with no commitment behind it
 * teaches nothing, because nobody was ever wrong.
 */
function PeakPrediction({
  lang,
  pointer,
  committed,
  answer,
  onCommit,
}: {
  lang: Lang;
  pointer: number | null;
  committed: number | null;
  answer: number | null;
  onCommit: () => void;
}) {
  const t = useT(lang);

  if (answer === null) {
    return (
      <p className="mt-4 text-center text-sm text-ink-400">
        {t("station1.peakLoading")}
      </p>
    );
  }

  if (committed !== null) {
    const verdict = t(
      peakVerdict(committed, answer).close
        ? "station1.peakClose"
        : "station1.peakFar",
      { pct: Math.round(answer * 100) },
    );
    return (
      <div className="rise mt-4 rounded-[18px] bg-ink-800/70 p-4 ring-1 ring-white/[0.06] ring-inset">
        <p className="text-sm font-bold text-white/85 sm:text-base">{verdict}</p>
        <p className="mt-1 text-xs text-ink-400 sm:text-sm">
          {t("station1.peakExplain")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-3 text-center">
      <p className="text-sm font-bold text-white/85 sm:text-base">
        {t("station1.peakPrompt")}
      </p>
      <BigButton onClick={onCommit} tone="miko" disabled={pointer === null}>
        {t("station1.peakCommit")}
      </BigButton>
    </div>
  );
}

/**
 * The picture of the sound.
 *
 * It used to draw a fixed 140 bars with a 3px gap between them. The gaps alone
 * came to 417px, so on any phone the waveform — and with it the whole card —
 * was wider than the screen. The bar count now follows the measured width, and
 * the peaks are re-bucketed rather than clipped, so the same clip reads as the
 * same shape at every size.
 */
function Waveform({
  peaks,
  progress,
  label,
}: {
  peaks: number[] | null;
  progress: number;
  label: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const bars = useMemo(() => {
    if (!peaks?.length) return null;
    return resamplePeaks(peaks, barCountFor(width));
  }, [peaks, width]);

  return (
    <div
      ref={ref}
      className="flex h-36 w-full min-w-0 items-center justify-center gap-[2px] overflow-hidden sm:h-48"
      role="img"
      aria-label={label}
    >
      {bars
        ? bars.map((p, i) => {
            const played = i / bars.length <= progress;
            return (
              <span
                key={i}
                aria-hidden
                className={`min-w-0 flex-1 rounded-full transition-colors ${
                  played ? "bg-miko-400" : "bg-ink-600"
                }`}
                style={{ height: `${Math.max(3, p * 100)}%` }}
              />
            );
          })
        : null}
    </div>
  );
}

/**
 * Stage C: the AI is guessing. Each chunk hesitates between candidate spellings
 * before settling — that visible hesitation is the point, not decoration.
 *
 * Driven by `reach` (the playhead's high-water mark, 0..1): a chunk starts
 * guessing when the audio reaches its slice of the clip and settles as the
 * slice ends, so Miko visibly hears-then-decides in time with the sound.
 */
function ChunkGuesses({ words, reach }: { words: string[]; reach: number }) {
  // Every word of the sentence — cutting the list short made Miko look like
  // he stopped listening halfway.
  const shown = words;
  const n = shown.length || 1;

  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2 sm:gap-3">
      {shown.map((w, i) => {
        // Each chunk owns 1/n of the clip, settling slightly before its end.
        const begin = (i / n) * 0.92;
        const settle = ((i + 0.75) / n) * 0.92;

        let text: string;
        if (reach < begin) {
          text = "…";
        } else if (reach < settle) {
          const mid = (reach - begin) / (settle - begin);
          text =
            mid < 0.5
              ? w.slice(0, 1) + "…"
              : w.slice(0, Math.max(1, Math.ceil(w.length / 2))) + "…";
        } else {
          text = w;
        }

        return (
          <span
            key={i}
            className={`rounded-xl px-3 py-1.5 text-base font-bold transition sm:px-4 sm:py-2 sm:text-xl ${
              text === w
                ? "bg-miko-400 text-ink-950"
                : "bg-ink-700 text-white/60 italic"
            }`}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}
