"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ClueBox } from "@/components/manifest-types";
import {
  usePrefersReducedMotion,
  useT,
  type Lang,
} from "@/components/kiosk/hooks";
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
      className="rise flex items-center gap-3 sm:gap-4"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <Persona
        who={who}
        size={size}
        mood={mood}
        className="breathe hidden shrink-0 sm:block"
      />
      <Persona
        who={who}
        size={Math.round(size * 0.6)}
        mood={mood}
        className="breathe shrink-0 sm:hidden"
      />
      <div
        className={`relative min-w-0 max-w-2xl rounded-[20px] px-4 py-3 text-base leading-snug font-bold text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_10px_30px_-8px_rgba(0,0,0,0.6)] sm:px-6 sm:py-4 sm:text-lg md:text-xl ${bg}`}
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
 *
 * Padding steps down below `sm` so two of these side by side (Station 2's
 * ECHT / NEP) still fit a 320px phone instead of pushing the card wider than
 * the screen.
 */
export function BigButton({
  children,
  onClick,
  tone = "neutral",
  disabled,
  className = "",
  type = "button",
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "real" | "fake" | "echo" | "miko";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  ariaLabel?: string;
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
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`min-h-14 max-w-full rounded-[20px] px-5 py-4 font-display text-lg font-extrabold break-words transition-[transform,background-color,opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35 sm:px-9 sm:py-5 sm:text-2xl md:text-[1.7rem] ${tones[tone]} ${className}`}
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
      <span className="flex items-center justify-center gap-3 sm:gap-4">
        <span className="grid h-7 w-7 shrink-0 place-items-center">
          {playing ? <Bars /> : <PlayGlyph />}
        </span>
        <span className="min-w-0">{label}</span>
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

/* -------------------------------------------------------------- media gaps */

/**
 * A generated image that might not be there. `web/public/samples/` is
 * gitignored, so a half-built pack is a completely ordinary state — and a
 * broken `<img>` icon in the middle of the hero evidence panel is the worst
 * possible way to communicate it.
 */
export function SampleImage({
  src,
  alt,
  className = "",
  fallbackLabel,
  onStatusChange,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel: string;
  onStatusChange?: (ok: boolean) => void;
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc === src;

  if (broken) {
    return (
      <div
        className={`grid place-items-center bg-ink-900 px-4 text-center ${className}`}
        role="img"
        aria-label={fallbackLabel}
      >
        <span className="font-mono text-[11px] leading-relaxed tracking-[0.14em] text-ink-400 uppercase">
          {fallbackLabel}
        </span>
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- generated asset; exact pixel mapping matters for the clue box */
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => {
        setBrokenSrc(src);
        onStatusChange?.(false);
      }}
      onLoad={() => onStatusChange?.(true)}
    />
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
 *
 * When it is scrubbable it is a real slider — `role="slider"`, arrow keys, Home
 * and End — because "tap the picture to hear that bit" was a pointer-only
 * instruction on a device that may well be driven by a keyboard or a switch.
 */
export interface SpectrogramMarker {
  /** 0..1 along the time axis. */
  fraction: number;
  tone: "guess" | "answer";
  label: string;
}

export function Spectrogram({
  image,
  clue,
  showClue = false,
  ghostClue = false,
  playhead,
  onScrub,
  scrubLabel,
  scrubHint,
  scanning = false,
  className = "",
  caption,
  alt,
  missingLabel,
  clueDescription,
  markers,
}: {
  image: string;
  clue?: ClueBox | null;
  showClue?: boolean;
  ghostClue?: boolean;
  playhead?: number;
  onScrub?: (fraction: number) => void;
  scrubLabel?: string;
  scrubHint?: string;
  scanning?: boolean;
  className?: string;
  caption?: string;
  /** What the picture shows, for anyone who cannot see it. */
  alt?: string;
  missingLabel?: string;
  /**
   * The text equivalent of the highlighted clue. Only ever passed once the
   * visitor has committed to an answer — before that it would be the answer.
   */
  clueDescription?: string;
  /** Vertical pins: where the visitor pointed, and where the answer was. */
  markers?: SpectrogramMarker[];
}) {
  const [position, setPosition] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const hintId = useId();

  const boxStyle: CSSProperties | undefined = clue
    ? {
        left: `${clue.box[0] * 100}%`,
        top: `${clue.box[1] * 100}%`,
        width: `${clue.box[2] * 100}%`,
        height: `${clue.box[3] * 100}%`,
      }
    : undefined;

  const scrubTo = useCallback(
    (fraction: number) => {
      const clamped = Math.min(1, Math.max(0, fraction));
      setPosition(clamped);
      onScrub?.(clamped);
    },
    [onScrub],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!onScrub) return;
      const step = event.shiftKey ? 0.2 : 0.05;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          event.preventDefault();
          scrubTo(position + step);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          event.preventDefault();
          scrubTo(position - step);
          break;
        case "Home":
          event.preventDefault();
          scrubTo(0);
          break;
        case "End":
          event.preventDefault();
          scrubTo(1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          scrubTo(position);
          break;
        default:
          break;
      }
    },
    [onScrub, position, scrubTo],
  );

  const sliderProps: React.HTMLAttributes<HTMLDivElement> = onScrub
    ? {
        role: "slider",
        tabIndex: 0,
        "aria-label": scrubLabel,
        "aria-describedby": scrubHint ? hintId : undefined,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": Math.round(position * 100),
        "aria-valuetext": `${Math.round(position * 100)}%`,
        onKeyDown,
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          const rect = event.currentTarget.getBoundingClientRect();
          scrubTo((event.clientX - rect.left) / rect.width);
          frameRef.current?.focus();
        },
      }
    : {};

  return (
    /* The height class must land on the image frame, not the <figure> — putting
       it on the figure leaves the <img> unconstrained, and it grows to its natural
       aspect and shoves the rest of the station off the card. */
    <figure className="rise flex w-full min-w-0 flex-col">
      <div
        ref={frameRef}
        {...sliderProps}
        className={`relative overflow-hidden rounded-[18px] bg-ink-950 ring-1 ring-white/10 ring-inset ${className} ${
          onScrub
            ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-echo-300 focus-visible:outline-2 focus-visible:outline-echo-300 focus-visible:outline-offset-2"
            : ""
        }`}
      >
        <SampleImage
          src={image}
          alt={alt ?? caption ?? ""}
          className="block h-full w-full object-fill"
          fallbackLabel={missingLabel ?? caption ?? ""}
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

        {markers?.map((marker) => (
          <span
            key={`${marker.tone}-${marker.fraction}`}
            className={`pointer-events-none absolute inset-y-0 w-[3px] rounded-full ${
              marker.tone === "answer" ? "bg-real-400" : "bg-miko-400"
            }`}
            style={{
              left: `calc(${Math.min(1, Math.max(0, marker.fraction)) * 100}% - 1.5px)`,
              boxShadow: "0 0 12px currentColor",
            }}
            role="img"
            aria-label={marker.label}
          />
        ))}
      </div>

      {(caption || scrubHint || clueDescription) && (
        <figcaption className="mt-2 space-y-1">
          {caption && (
            <span className="block font-mono text-[11px] tracking-[0.14em] text-ink-400 uppercase">
              {caption}
            </span>
          )}
          {scrubHint && (
            <span id={hintId} className="block text-xs text-ink-400">
              {scrubHint}
            </span>
          )}
          {/* The clue in words. Someone who cannot see the highlighted box — or
              cannot hear the clip it points at — gets the same evidence Echo
              just gave everyone else, and only after the guess is committed. */}
          {clueDescription && (
            <span className="block text-xs leading-relaxed text-ink-400">
              {clueDescription}
            </span>
          )}
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
      className={`stamp inline-block max-w-full rounded-2xl border-[5px] px-5 py-2 font-display text-3xl font-black tracking-[0.06em] uppercase sm:px-8 sm:py-2.5 sm:text-4xl md:text-5xl ${c}`}
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
  label,
}: {
  total: number;
  current: number;
  /** Spoken equivalent — "Mission 3 of 5". The bars themselves say nothing. */
  label: string;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 sm:gap-1.5"
      role="img"
      aria-label={label}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
            i === current
              ? "w-6 bg-echo-400 sm:w-8"
              : i < current
                ? "w-2.5 bg-echo-600 sm:w-3"
                : "w-2.5 bg-ink-700 sm:w-3"
          }`}
        />
      ))}
    </div>
  );
}

const LANG_NAMES: Record<Lang, string> = { nl: "Nederlands", en: "English" };

/**
 * A two-option switch, not two links. `aria-pressed` states which language is
 * selected (a colour change alone said nothing), each button carries its own
 * `lang` so the label is pronounced in the language it names, and the group has
 * a name so it is not announced as two loose buttons called "nl" and "en".
 */
export function LangToggle({
  lang,
  onChange,
  groupLabel,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
  groupLabel: string;
}) {
  return (
    <div
      className="flex shrink-0 overflow-hidden rounded-[14px] bg-ink-800 p-1 ring-1 ring-white/10 ring-inset"
      role="group"
      aria-label={groupLabel}
    >
      {(["nl", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => onChange(l)}
          // WCAG-sized hit area; the surrounding pill adds only visual padding.
          className={`min-h-11 min-w-11 rounded-[10px] px-3 font-mono text-xs font-bold tracking-widest uppercase transition-[background-color,color] duration-150 sm:px-4 ${
            lang === l
              ? "bg-echo-400 text-ink-950"
              : "text-ink-400 hover:text-white"
          }`}
        >
          <span aria-hidden>{l}</span>
          <span className="sr-only">{LANG_NAMES[l]}</span>
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
      className="pop flex w-20 flex-col items-center gap-2 sm:w-24"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-b from-miko-300 to-miko-600 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_12px_24px_-10px_rgba(245,166,35,0.7)] sm:h-20 sm:w-20">
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
    <div className="pop mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 rounded-[28px] bg-ink-900/80 p-4 ring-1 ring-white/10 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_40px_80px_-30px_rgba(0,0,0,0.9)] ring-inset backdrop-blur-xl sm:gap-6 sm:rounded-[44px] sm:p-6 md:p-8">
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
      className={`min-w-0 rounded-[20px] bg-ink-950/60 ring-1 ring-white/[0.06] ring-inset ${className}`}
    >
      {children}
    </div>
  );
}

/** An audible problem, stated plainly, with a way out. */
export function AudioProblem({
  lang,
  message,
  onRetry,
  retryLabel,
}: {
  lang: Lang;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const t = useT(lang);
  return (
    <div
      className="rise flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-fake-500/10 p-4 ring-1 ring-fake-500/40 ring-inset"
      role="alert"
    >
      <p className="min-w-0 text-base font-bold text-fake-400">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 shrink-0 rounded-[14px] bg-ink-800 px-4 font-bold text-white ring-1 ring-white/10 transition-transform duration-150 ring-inset active:scale-[0.96]"
        >
          {retryLabel ?? t("audio.retry")}
        </button>
      )}
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
 *
 * Two things it must not do. It must not read as 47 separate updates to a
 * screen reader, so the animating text is hidden and the finished line is
 * exposed once, whole. And it must not gate the demo on an animation: under
 * `prefers-reduced-motion` the line appears complete and `onDone` still fires,
 * because Station 4's punchline waits on it.
 */
export function Typewriter({
  text,
  speedMs = 42,
  totalMs,
  onDone,
  className = "",
  paused = false,
}: {
  text: string;
  speedMs?: number;
  totalMs?: number;
  onDone?: () => void;
  className?: string;
  /** Holds the pen — used while the audio it is paced against is not running. */
  paused?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // No state reset here — callers remount via `key` for a fresh line.
  useEffect(() => {
    if (reduced || paused) return;
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
  }, [text, speedMs, totalMs, reduced, paused]);

  const visibleCount = reduced ? text.length : count;

  useEffect(() => {
    if (visibleCount >= text.length && !doneRef.current) {
      doneRef.current = true;
      onDoneRef.current?.();
    }
  }, [visibleCount, text]);

  const complete = visibleCount >= text.length;

  return (
    <>
      {/* The animation is decoration over a line that is already available in
          full below it, so it stays out of the accessibility tree entirely —
          swapping the two on completion would re-read the whole sentence. */}
      <span className={className} aria-hidden>
        {text.slice(0, visibleCount)}
        {!complete && (
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-middle" />
        )}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}
