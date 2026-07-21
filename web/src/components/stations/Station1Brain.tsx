"use client";

import { useCallback, useEffect, useState } from "react";
import type { Clip } from "@/components/manifest-types";
import { useAudio, useT, type Lang } from "@/components/kiosk/hooks";
import {
  BigButton,
  Panel,
  PersonaBubble,
  PlayButton,
  Spectrogram,
  StationCard,
  Typewriter,
} from "@/components/kiosk/ui";

type Stage = 0 | 1 | 2 | 3 | 4;
const STAGES: Stage[] = [0, 1, 2, 3, 4];

/**
 * Station 1 — "In het brein van de spraak-AI".
 *
 * Walks the visitor through the five things that happen between a sound and a
 * word: vibrations → a picture of the sound → guessed chunks → the black box
 * (a stylised network the chunks pass through — even Miko can't see inside) →
 * text. The last stage is the one that matters: Miko *guesses*, and guesses
 * can be wrong.
 *
 * Everything on screen is driven by the audio playhead, not by free-running
 * timers. The old version typed and flickered on its own clock, so the text
 * regularly finished before the clip had said the words — the exact
 * "he wrote it before he heard it" mismatch this station exists to explain.
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
  const { ref, play, playing, progress } = useAudio(clip.audio);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  /**
   * The playhead's high-water mark for the current stage. Chunks settle against
   * THIS, not the raw playhead: a replay rewinds `progress` to 0, and the
   * already-settled words must stay settled instead of dissolving back to "…".
   * Fed straight from timeupdate events (not derived from `progress`) so a
   * stale playhead value can never leak across a stage change.
   */
  const [reach, setReach] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => {
      const p = el.duration ? el.currentTime / el.duration : 0;
      setReach((m) => (p > m ? p : m));
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [ref]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const buf = await fetch(clip.audio).then((r) => r.arrayBuffer());
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audio = await new Ctx().decodeAudioData(buf);
        const raw = audio.getChannelData(0);
        const buckets = 140;
        const size = Math.floor(raw.length / buckets);
        const out: number[] = [];
        for (let i = 0; i < buckets; i++) {
          let peak = 0;
          for (let j = 0; j < size; j++) {
            const v = Math.abs(raw[i * size + j] ?? 0);
            if (v > peak) peak = v;
          }
          out.push(peak);
        }
        const max = Math.max(...out, 0.01);
        if (!cancelled) setPeaks(out.map((p) => p / max));
      } catch {
        if (!cancelled) setPeaks(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clip.audio]);

  const words = (clip.transcript ?? "").split(/\s+/).filter(Boolean);

  const advance = useCallback(() => {
    if (stage < 4) {
      setStage((s) => (s + 1) as Stage);
      setReach(0);
      play();
    } else {
      onDone();
    }
  }, [stage, play, onDone]);

  const scrub = useCallback(
    (fraction: number) => {
      const el = ref.current;
      if (!el) return;
      el.currentTime = fraction * (el.duration || clip.durationSec);
      void el.play().catch(() => {});
    },
    [ref, clip.durationSec],
  );

  const bubbleText =
    stage === 4 && handoff
      ? t("station1.handoff")
      : t(`station1.stage${stage}.miko`);

  return (
    <StationCard>
      <audio ref={ref} src={clip.audio} preload="auto" />

      {/* Keyed on its text so each new line re-enters instead of snapping. */}
      <PersonaBubble
        key={bubbleText}
        who="miko"
        mood={playing ? "listening" : handoff && stage === 4 ? "happy" : "idle"}
      >
        {bubbleText}
      </PersonaBubble>

      <div className="flex items-center gap-2">
        {STAGES.map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              s <= stage ? "bg-miko-400" : "bg-ink-700"
            }`}
          />
        ))}
      </div>

      <Panel className="grid min-h-[19rem] place-items-center p-6">
        {stage === 0 && <Waveform peaks={peaks} progress={progress} />}

        {stage === 3 && (
          <BrainBox words={words} label={t("station1.brainLabel")} />
        )}

        {(stage === 1 || stage === 2 || stage === 4) && (
          <div className="w-full">
            <Spectrogram
              image={clip.spectrogram.image}
              className="h-56 w-full"
              playhead={playing ? progress : undefined}
              onScrub={stage === 1 ? scrub : undefined}
              caption={t("station1.specLabel")}
            />
            {stage === 2 && <ChunkGuesses words={words} reach={reach} />}
            {stage === 4 && (
              <p className="rise mt-5 rounded-[20px] bg-ink-800 px-6 py-4 text-center text-2xl font-bold text-miko-300 md:text-3xl">
                “
                <Typewriter
                  key={clip.id}
                  text={clip.transcript || t("station1.noTranscript")}
                  totalMs={clip.durationSec * 1000}
                  onDone={() => setHandoff(true)}
                />
                ”
              </p>
            )}
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <PlayButton
          onClick={play}
          playing={playing}
          tone="miko"
          label={t("common.listen")}
        />
        <BigButton onClick={advance} tone="echo">
          {stage < 4 ? t("common.next") : t("station1.toStation2")}
        </BigButton>
      </div>
    </StationCard>
  );
}

/**
 * The black box, taken literally: guessed chunks go in, decided words come
 * out, and the thing in the middle is a closed dark box with a "?" — because
 * that IS the honest answer to what happens inside. A barely-visible mesh
 * rewards a closer look without pretending the process is legible. The chunks
 * and words come from the clip's own transcript, so the wrong guesses the
 * visitor just watched ("Mikkel") visibly survive into the output.
 */
function BrainBox({ words, label }: { words: string[]; label: string }) {
  const io = words.slice(0, 3);

  return (
    <figure className="rise flex w-full flex-col items-center">
      <div className="flex w-full max-w-3xl items-center justify-center gap-3 rounded-[18px] bg-ink-950 p-6 ring-1 ring-white/10 ring-inset md:gap-5">
        {/* in: the guessed chunks from the previous stage */}
        <div className="flex flex-col items-end gap-2">
          {io.map((w, i) => (
            <span
              key={i}
              className="rise rounded-lg bg-ink-700 px-3 py-1.5 text-base font-bold text-white/60 italic"
              style={{ animationDelay: `${i * 140}ms` }}
            >
              {w.slice(0, Math.max(1, Math.ceil(w.length / 2)))}…
            </span>
          ))}
        </div>

        <span className="text-2xl text-ink-500" aria-hidden>→</span>

        <div className="relative grid h-40 w-40 shrink-0 place-items-center overflow-hidden rounded-[16px] bg-black ring-1 ring-white/15 ring-inset md:h-44 md:w-44">
          {/* the mesh you can almost see */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
            {[20, 50, 80].map((x, li) =>
              [25, 50, 75].map((y1) =>
                li < 2
                  ? [25, 50, 75].map((y2) => (
                      <line
                        key={`${x}-${y1}-${y2}`}
                        x1={x}
                        y1={y1}
                        x2={x + 30}
                        y2={y2}
                        stroke="#ffc45c"
                        strokeWidth="0.6"
                        opacity="0.1"
                      />
                    ))
                  : null,
              ),
            )}
            {[20, 50, 80].map((x) =>
              [25, 50, 75].map((y) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={3} fill="#ffc45c" opacity="0.15" />
              )),
            )}
          </svg>
          <span
            className="relative font-display text-6xl font-black text-white/40"
            style={{ animation: "nodepulse 2.2s ease-in-out infinite" }}
          >
            ?
          </span>
        </div>

        <span className="text-2xl text-ink-500" aria-hidden>→</span>

        {/* out: the same chunks, decided — mistakes included */}
        <div className="flex flex-col items-start gap-2">
          {io.map((w, i) => (
            <span
              key={i}
              className="rise rounded-lg bg-miko-400 px-3 py-1.5 text-base font-bold text-ink-950"
              style={{ animationDelay: `${600 + i * 140}ms` }}
            >
              {w}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 font-mono text-[11px] tracking-[0.14em] text-ink-400 uppercase">
        {label}
      </figcaption>
    </figure>
  );
}

function Waveform({
  peaks,
  progress,
}: {
  peaks: number[] | null;
  progress: number;
}) {
  if (!peaks) {
    return <p className="text-white/50">…</p>;
  }
  return (
    <div className="flex h-48 w-full items-center justify-center gap-[3px]">
      {peaks.map((p, i) => {
        const played = i / peaks.length <= progress;
        return (
          <span
            key={i}
            className={`w-full rounded-full transition-colors ${
              played ? "bg-miko-400" : "bg-ink-600"
            }`}
            style={{ height: `${Math.max(3, p * 100)}%` }}
          />
        );
      })}
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
    <div className="mt-5 flex flex-wrap justify-center gap-3">
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
            className={`rounded-xl px-4 py-2 text-xl font-bold transition ${
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
