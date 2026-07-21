"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ClueBox } from "@/components/manifest-types";
import type { Lang } from "@/components/kiosk/hooks";
import {
  Persona,
  type PersonaId,
  type PersonaMood,
} from "@/components/kiosk/Personas";

export { Persona };
export type { PersonaId, PersonaMood };

/* ------------------------------------------------------------------ speech */

export function PersonaBubble({
  who,
  children,
  mood = "idle",
  tone,
  size = 88,
  delayMs = 0,
}: {
  who: PersonaId;
  children: ReactNode;
  mood?: PersonaMood;
  /** Overrides the speaker's usual colour — used when Echo raises the alarm. */
  tone?: "alert";
  size?: number;
  delayMs?: number;
}) {
  const alert = tone === "alert";
  const bg = alert
    ? "bg-fake-500"
    : who === "miko"
      ? "bg-miko-400"
      : "bg-echo-400";

  return (
    <div
      className="rise flex items-center gap-4"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <Persona who={who} size={size} mood={mood} className="breathe shrink-0" />
      <div
        className={`relative max-w-2xl rounded-[20px] px-6 py-4 text-lg leading-snug font-bold text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_10px_30px_-8px_rgba(0,0,0,0.6)] md:text-xl ${bg}`}
      >
        <span
          className={`absolute top-1/2 -left-1.5 h-4 w-4 -translate-y-1/2 rotate-45 rounded-[3px] ${bg}`}
        />
        <span className="relative">{children}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- buttons */

/**
 * Radii are concentric: this button is r=20 and sits inside cards padded by 24
 * with r=44 (20 + 24). Press feedback is a 0.96 scale on a transform-only
 * transition, so it stays interruptible and cheap to composite.
 */
export function BigButton({
  children,
  onClick,
  tone = "neutral",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "real" | "fake" | "echo" | "miko";
  disabled?: boolean;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral:
      "bg-ink-700 text-white shadow-[0_1px_0_rgba(255,255,255,0.10)_inset,0_12px_28px_-10px_rgba(0,0,0,0.8)] hover:bg-ink-600",
    real: "bg-real-500 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_14px_30px_-10px_rgba(34,201,138,0.6)] hover:bg-real-400",
    fake: "bg-fake-500 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_14px_30px_-10px_rgba(255,77,109,0.6)] hover:bg-fake-400",
    echo: "bg-echo-400 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_14px_30px_-10px_rgba(53,214,199,0.55)] hover:bg-echo-300",
    miko: "bg-miko-400 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_14px_30px_-10px_rgba(255,196,92,0.55)] hover:bg-miko-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[20px] px-9 py-5 font-display text-2xl font-extrabold transition-[transform,background-color,opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35 md:text-[1.7rem] ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function PlayButton({
  onClick,
  playing,
  label,
  disabled,
  tone = "echo",
}: {
  onClick: () => void;
  playing: boolean;
  label: string;
  disabled?: boolean;
  tone?: "echo" | "miko";
}) {
  return (
    <BigButton onClick={onClick} tone={tone} disabled={disabled}>
      <span className="flex items-center gap-4">
        <span className="grid h-7 w-7 place-items-center">
          {playing ? <Bars /> : <PlayGlyph />}
        </span>
        {label}
      </span>
    </BigButton>
  );
}

/** Optically centred: a triangle's visual mass sits left of its bounding box. */
function PlayGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <path d="M6.5 3.5 18 11 6.5 18.5z" fill="currentColor" />
    </svg>
  );
}

function Bars() {
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current"
          style={{
            height: "100%",
            transformOrigin: "center",
            animation: `bar ${0.5 + i * 0.14}s ease-in-out ${i * 0.08}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------- spectrogram */

/**
 * The evidence. This is the demo's hero image and it used to be rendered as a
 * flat grey rectangle, which sold the single most important idea — "this is the
 * picture the AI actually looks at" — as an afterthought.
 *
 * It is now framed like something under glass: inset ring, a scan sweep when
 * Echo analyses it, and a spotlight that dims everything except the clue.
 */
export function Spectrogram({
  image,
  clue,
  showClue = false,
  ghostClue = false,
  playhead,
  onScrub,
  scanning = false,
  className = "",
  caption,
}: {
  image: string;
  clue?: ClueBox | null;
  showClue?: boolean;
  ghostClue?: boolean;
  playhead?: number;
  onScrub?: (fraction: number) => void;
  scanning?: boolean;
  className?: string;
  caption?: string;
}) {
  const boxStyle = clue
    ? {
        left: `${clue.box[0] * 100}%`,
        top: `${clue.box[1] * 100}%`,
        width: `${clue.box[2] * 100}%`,
        height: `${clue.box[3] * 100}%`,
      }
    : undefined;

  return (
    /* The height class must land on the image frame, not the <figure> — putting
       it on the figure leaves the <img> unconstrained, and it grows to its natural
       aspect and shoves the rest of the station off the card. */
    <figure className="rise flex w-full flex-col">
      <div
        className={`relative overflow-hidden rounded-[18px] bg-ink-950 ring-1 ring-white/10 ring-inset ${className} ${
          onScrub ? "cursor-pointer" : ""
        }`}
        onPointerDown={
          onScrub
            ? (e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onScrub(
                  Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                );
              }
            : undefined
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- generated asset; exact pixel mapping matters for the clue box */}
        <img
          src={image}
          alt={caption ?? "spectrogram"}
          className="block h-full w-full object-fill"
          draggable={false}
        />

        {scanning && (
          <span
            className="scan pointer-events-none absolute inset-y-0 w-1/4"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(53,214,199,0.35), transparent)",
            }}
          />
        )}

        {clue && showClue && (
          <div
            className={`pointer-events-none absolute rounded-[10px] ${
              ghostClue
                ? "border-2 border-dashed border-white/40"
                : "clue border-[3px]"
            }`}
            style={{
              ...boxStyle,
              ...(ghostClue
                ? { boxShadow: "0 0 0 9999px rgba(5,7,15,0.4)" }
                : {}),
            }}
          />
        )}

        {playhead !== undefined && playhead > 0 && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.8)]"
            style={{ left: `${playhead * 100}%` }}
          />
        )}
      </div>

      {caption && (
        <figcaption className="mt-2 font-mono text-[11px] tracking-[0.14em] text-ink-400 uppercase">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/* ---------------------------------------------------------------- verdicts */

export function Stamp({ correct, text }: { correct: boolean; text: string }) {
  const c = correct ? "text-real-400 border-real-400" : "text-fake-400 border-fake-400";
  return (
    <div
      className={`stamp inline-block rounded-2xl border-[5px] px-8 py-2.5 font-display text-4xl font-black tracking-[0.06em] uppercase md:text-5xl ${c}`}
      style={{ boxShadow: "0 0 40px -12px currentColor" }}
    >
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

/** Case-file rail. Five slots; the current one is a filled bar, not a dot. */
export function ProgressRail({
  total,
  current,
}: {
  total: number;
  current: number;
}) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
            i === current
              ? "w-8 bg-echo-400"
              : i < current
                ? "w-3 bg-echo-600"
                : "w-3 bg-ink-700"
          }`}
        />
      ))}
    </div>
  );
}

export function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[14px] bg-ink-800 p-1 ring-1 ring-white/10 ring-inset">
      {(["nl", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          // 40px minimum hit area even though the pill looks smaller.
          className={`min-h-10 rounded-[10px] px-4 font-mono text-xs font-bold tracking-widest uppercase transition-[background-color,color] duration-150 ${
            lang === l
              ? "bg-echo-400 text-ink-950"
              : "text-ink-400 hover:text-white"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Earned badge. A struck medal, not an emoji. */
export function Badge({
  icon,
  label,
  delayMs = 0,
}: {
  icon: ReactNode;
  label: string;
  delayMs?: number;
}) {
  return (
    <div
      className="pop flex w-24 flex-col items-center gap-2"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-b from-miko-300 to-miko-600 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_12px_24px_-10px_rgba(245,166,35,0.7)]">
        {icon}
      </div>
      <span className="text-center text-xs leading-tight font-bold text-ink-400">
        {label}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- surface */

/** r=44 outer; children use r=20 with p-6 (24) to stay concentric. */
export function StationCard({ children }: { children: ReactNode }) {
  return (
    <div className="pop mx-auto flex w-full max-w-6xl flex-col gap-6 rounded-[44px] bg-ink-900/80 p-6 ring-1 ring-white/10 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_40px_80px_-30px_rgba(0,0,0,0.9)] ring-inset backdrop-blur-xl md:p-8">
      {children}
    </div>
  );
}

/** A framed sub-surface inside a StationCard (r=20 to sit concentric in p-6). */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[20px] bg-ink-950/60 ring-1 ring-white/[0.06] ring-inset ${className}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- typewriter */

/**
 * Types text out letter by letter — Miko writing down what he heard.
 * Callers pass `key={text}` so a new line remounts and restarts cleanly.
 *
 * `totalMs` paces the whole line to finish in that many milliseconds — used to
 * keep Miko's writing in step with the clip he is hearing, instead of letting
 * the text race ahead of (or lag behind) the audio. `onDone` fires once when
 * the last character lands, so callers can hold the NEXT beat (Miko's verdict,
 * the handoff line) until he has actually finished writing.
 */
export function Typewriter({
  text,
  speedMs = 42,
  totalMs,
  onDone,
  className = "",
}: {
  text: string;
  speedMs?: number;
  totalMs?: number;
  onDone?: () => void;
  className?: string;
}) {
  const [count, setCount] = useState(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // No state reset here — callers remount via `key` for a fresh line, exactly
  // as before `totalMs` existed.
  useEffect(() => {
    const step = totalMs
      ? Math.max(16, totalMs / Math.max(1, text.length))
      : speedMs;
    const timer = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          clearInterval(timer);
          return c;
        }
        return c + 1;
      });
    }, step);
    return () => clearInterval(timer);
  }, [text, speedMs, totalMs]);

  useEffect(() => {
    if (count >= text.length && !doneRef.current) {
      doneRef.current = true;
      onDoneRef.current?.();
    }
  }, [count, text]);

  return (
    <span className={className}>
      {text.slice(0, count)}
      {count < text.length && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-middle" />
      )}
    </span>
  );
}
