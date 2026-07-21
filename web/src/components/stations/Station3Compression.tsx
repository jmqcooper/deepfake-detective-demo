"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CodecRung } from "@/components/manifest-types";
import { useT, type Lang } from "@/components/kiosk/hooks";
import {
  BigButton,
  Panel,
  Persona,
  PersonaBubble,
  StationCard,
} from "@/components/kiosk/ui";
import {
  IconChat,
  IconPhone,
  IconRadio,
  IconStudio,
} from "@/components/kiosk/icons";

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
 * The payoff: Miko still understands every rung, but the high band where
 * Echo's evidence lives is visibly gone. Compression spares the message and
 * destroys the forensics — which is exactly why voice-note deepfakes are hard.
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
  const [started, setStarted] = useState(false);
  const [playingLevel, setPlayingLevel] = useState<number | null>(null);
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const refs = useRef<(HTMLAudioElement | null)[]>([]);
  // Tour mode auto-advances on `ended`; a visitor's tap switches to free play.
  const mode = useRef<"tour" | "free">("tour");

  const rung = ladder[level];
  // 0 at studio → 1 at the worst rung: how much evidence has been destroyed.
  const damage = ladder.length > 1 ? level / (ladder.length - 1) : 0;

  // English mirrors of the ladder exist wherever the pack generated them;
  // otherwise every language hears the Dutch original.
  const en = lang === "en";
  const rungAudio = (r: CodecRung) => (en && r.audioEn ? r.audioEn : r.audio);
  const rungSpec = en && rung.spectrogramEn ? rung.spectrogramEn : rung.spectrogram;
  const rungTranscript =
    en && rung.transcriptEn !== undefined ? rung.transcriptEn : rung.transcript;

  const playRung = useCallback((i: number) => {
    refs.current.forEach((el, j) => {
      if (!el) return;
      if (j === i) {
        el.currentTime = 0;
        void el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
    setLevel(i);
    setPlayingLevel(i);
    setVisited((v) => new Set(v).add(i));
  }, []);

  const start = () => {
    setStarted(true);
    mode.current = "tour";
    playRung(0);
  };

  const choose = (next: number) => {
    // A tap takes over from the tour: from here on, one play per tap.
    mode.current = "free";
    playRung(next);
  };

  // The tour: when a rung finishes, step down to the next one.
  const onEnded = useCallback(
    (i: number) => {
      setPlayingLevel((p) => (p === i ? null : p));
      if (mode.current !== "tour") return;
      if (i + 1 < ladder.length) {
        // Brief breath between rungs so each level registers as its own beat.
        setTimeout(() => {
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
      refs.current.forEach((el) => el?.pause());
    },
    [],
  );

  const exploredAll = visited.size >= ladder.length;

  return (
    <StationCard>
      {ladder.map((r, i) => (
        <audio
          key={`${r.id}-${lang}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          src={rungAudio(r)}
          preload="auto"
          onEnded={() => onEnded(i)}
        />
      ))}

      {/* Echo's briefing stays put while the machine runs its tour; the
          conclusion arrives as its own panel below once all rungs are heard. */}
      <PersonaBubble who="echo">{t("station3.echoIntro")}</PersonaBubble>

      {!started ? (
        <Panel className="grid min-h-[22rem] place-items-center">
          <BigButton onClick={start} tone="echo" className="halo">
            {t("station3.start")}
          </BigButton>
        </Panel>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="relative overflow-hidden rounded-[18px] bg-ink-950 ring-1 ring-white/10 ring-inset">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated asset */}
            <img
              src={rungSpec}
              alt={t(rung.labelKey)}
              className="block h-72 w-full object-fill"
              draggable={false}
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
          />
        </div>
      )}

      {/* Miko's own transcript at this quality. An EMPTY transcript is the
          strongest beat of all: at the worst rungs the ASR genuinely hears
          nothing, and we say so rather than hiding the panel. */}
      {started && rungTranscript !== undefined && (
        <Panel className="flex items-center gap-4 p-4">
          <Persona
            who="miko"
            size={52}
            mood={playingLevel !== null ? "listening" : "idle"}
          />
          <div className="min-w-0">
            <p className="mb-0.5 font-mono text-[10px] font-bold tracking-[0.16em] text-miko-400 uppercase">
              {t("station3.mikoHears")}
            </p>
            {rungTranscript ? (
              <p className="truncate text-lg font-bold text-white/85">
                “{rungTranscript}”
              </p>
            ) : (
              <p className="text-lg font-bold text-fake-400 italic">
                {t("station3.mikoHearsNothing")}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* The case-closed moment: once all four rungs have been heard, Echo
          delivers the verdict of this station — compression spares the words
          but destroys the evidence — in a panel of its own. */}
      {started && exploredAll && (
        <div className="rise flex items-center gap-4 rounded-[20px] bg-echo-500/10 p-5 ring-1 ring-echo-500/40 ring-inset">
          <Persona who="echo" size={56} mood="alert" className="shrink-0" />
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[11px] font-bold tracking-[0.16em] text-echo-300 uppercase">
              {t("station3.conclusion")}
            </p>
            <p className="text-lg font-bold text-white/90">
              {t("station3.echoAfter")}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <BigButton onClick={onDone} tone="echo" disabled={!exploredAll}>
          {exploredAll ? t("common.next") : t("station3.tryAll")}
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
}: {
  ladder: CodecRung[];
  level: number;
  playingLevel: number | null;
  onChange: (i: number) => void;
  label: (r: CodecRung) => string;
}) {
  return (
    /* Outer r=20 with p-3 (12) → children r=8... but the rungs read better as
       chunky targets, so: outer r=24, p-3, children r=16 (16 + 8 = 24). */
    <div className="flex flex-col justify-between gap-2 rounded-[24px] bg-ink-950/60 p-3 ring-1 ring-white/[0.06] ring-inset">
      {ladder.map((r, i) => {
        const active = i === level;
        const Icon = RUNG_ICONS[i] ?? IconStudio;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(i)}
            className={`flex min-h-14 min-w-52 items-center gap-3 rounded-[16px] px-4 py-3 text-left text-lg font-extrabold transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] ${
              active
                ? "bg-echo-400 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_10px_24px_-10px_rgba(53,214,199,0.7)]"
                : "text-ink-400 hover:bg-ink-800 hover:text-white"
            }`}
          >
            <Icon />
            <span className="flex-1">{label(r)}</span>
            {playingLevel === i && (
              <span className="flex h-4 items-center gap-[2px]" aria-hidden>
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
