"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Manifest } from "@/components/manifest-types";
import { parseManifest } from "@/lib/manifest-schema";
import {
  INITIAL_PLAYBACK,
  mediaErrorToPlaybackError,
  playRejectionToPlaybackError,
  progressOf,
  type PlaybackState,
} from "@/lib/audio-state";
import { uuidV4 } from "@/lib/uuid";
import type { EventResponse } from "@/lib/events";
import type { FinalScenarioChoice } from "@/lib/final-scenario";
import { DICTIONARIES } from "@/lib/i18n";
import { translate } from "@/lib/i18n-core";

export type Lang = "nl" | "en";

/**
 * Dutch-first translator. Falls back to English, then to the key itself.
 * The rules live in `lib/i18n-core` so the same ones apply everywhere and can
 * be tested without a bundler.
 */
export function useT(lang: Lang) {
  return useCallback(
    (key: string, vars?: Record<string, string | number>): string =>
      translate(DICTIONARIES, lang, key, vars),
    [lang],
  );
}

/**
 * Language, persisted in localStorage.
 *
 * Read through useSyncExternalStore rather than an effect: the server has no
 * localStorage, so the first client render must still produce the Dutch default
 * to match the server HTML, and only then swap to the stored choice. Doing that
 * with a setState-in-effect would be a cascading render (and React 19 rejects it).
 */
const LANG_EVENT = "kiosk:lang";
let ephemeralLang: Lang = "nl";

function subscribeLang(onChange: () => void) {
  window.addEventListener(LANG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readLang(): Lang {
  try {
    const stored = window.localStorage.getItem("lang");
    if (stored === "en" || stored === "nl") ephemeralLang = stored;
    return ephemeralLang;
  } catch {
    // Private mode / storage disabled: the toggle still works for this visit.
    return ephemeralLang;
  }
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, readLang, () => "nl" as Lang);

  const set = useCallback((l: Lang) => {
    ephemeralLang = l;
    try {
      window.localStorage.setItem("lang", l);
    } catch {
      // Ignored: the in-memory toggle below is what the UI actually reads.
    }
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);

  /**
   * The document's language has to follow the toggle. A screen reader picks its
   * voice from `<html lang>`, so a Dutch synthesiser reading the English copy
   * (or the reverse) was the single most broken thing about the toggle — it
   * changed every visible string and none of the spoken ones.
   */
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return [lang, set];
}

export type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: Manifest }
  | { status: "missing" }
  | { status: "malformed"; problems: string[] };

/**
 * The stations fetch the pack directly so stations 2–5 stay pure static assets.
 * It is validated here against the same schema the API uses, so a half-generated
 * or hand-edited pack produces the friendly setup screen instead of a station
 * that renders and then throws on the first missing field.
 */
export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/samples/manifest.json", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!cancelled) setState({ status: "missing" });
          return;
        }
        const parsed = parseManifest((await response.json()) as unknown);
        if (cancelled) return;
        setState(
          parsed.ok
            ? { status: "ready", manifest: parsed.manifest }
            : { status: "malformed", problems: parsed.problems },
        );
      } catch (error: unknown) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setState({ status: "missing" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}

/**
 * Anonymous session id. Lives in memory only — a reset mints a new one, and
 * nothing about a visitor is ever correlated across sessions. Both the initial
 * value and the reset go through the same generator, which has a fallback for
 * browsers without `crypto.randomUUID` (see lib/uuid.ts).
 */
export function useSession() {
  const [sessionId, setSessionId] = useState<string>(() => uuidV4());
  const reset = useCallback(() => setSessionId(uuidV4()), []);
  return { sessionId, reset };
}

export interface DemoEventInput {
  station: number;
  type:
    | "station_enter"
    | "station_complete"
    | "station_skip"
    | "guess"
    | "session_complete"
    | "session_reset"
    | "final_scenario";
  clipId?: string;
  guess?: "real" | "fake";
  choice?: FinalScenarioChoice;
}

/**
 * Telemetry, and — for a guess — the server's answer.
 *
 * The kiosk must never stall or error because the stats backend is down, so a
 * failure resolves to `null` rather than throwing. Callers that need the
 * verdict (Station 2, the final scenario) await it and fall back gracefully;
 * callers that are only reporting ignore the promise.
 */
export function useEvents(sessionId: string, lang: Lang) {
  return useCallback(
    async (e: DemoEventInput): Promise<EventResponse | null> => {
      try {
        const response = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...e, sessionId, lang }),
          keepalive: true,
        });
        if (!response.ok && response.status !== 202) return null;
        return (await response.json()) as EventResponse;
      } catch {
        return null;
      }
    },
    [sessionId, lang],
  );
}

export type TrackFn = ReturnType<typeof useEvents>;

/** Resets the kiosk after a visitor wanders off. */
export function useIdleReset(timeoutMs: number, onIdle: () => void) {
  const cb = useRef(onIdle);

  // Keep the latest callback in the ref without restarting the idle timer on
  // every render. Assigning during render would be a ref write mid-render.
  useEffect(() => {
    cb.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), timeoutMs);
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    bump();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, [timeoutMs]);
}

/**
 * Choreographed reveals. Returns the current beat (0..delays.length): beat 0 is
 * immediate, beat n fires delays[n-1] ms after mount. One reveal used to dump
 * verdict, explanation, stat and evidence on screen simultaneously — sequencing
 * them is what makes each land as its own moment.
 *
 * Under `prefers-reduced-motion` every beat lands at once. The staging is a
 * motion effect; withholding *content* from someone who asked for less motion
 * would be withholding the lesson.
 */
export function useBeat(delays: number[]): number {
  const reduced = usePrefersReducedMotion();
  const [beat, setBeat] = useState(0);
  // The delay list is fixed per mount; callers remount (via key) to restart.
  const delaysRef = useRef(delays);

  useEffect(() => {
    if (reduced) {
      setBeat(delaysRef.current.length);
      return;
    }
    const timers = delaysRef.current.map((d, i) =>
      setTimeout(() => setBeat(i + 1), d),
    );
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  return beat;
}

/* ------------------------------------------------------------ environment */

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

export function usePrefersReducedMotion(): boolean {
  const subscribe = useMemo(
    () => subscribeMedia("(prefers-reduced-motion: reduce)"),
    [],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Element width, for anything whose *count* has to fit the screen rather than
 * its size. Station 1's waveform drew a fixed 140 bars with a 3px gap: on a
 * 320px phone the gaps alone were wider than the viewport.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(el.clientWidth);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/* ----------------------------------------------------------------- audio */

export interface AudioController extends PlaybackState {
  ref: React.RefObject<HTMLAudioElement | null>;
  /** Resolves true when the clip actually started. Never throws. */
  play: () => Promise<boolean>;
  stop: () => void;
  /** Jump to a 0..1 position and play from there. */
  seek: (fraction: number) => Promise<boolean>;
  playing: boolean;
  loading: boolean;
  failed: boolean;
}

/**
 * One `<audio>` element per component, with honest state.
 *
 * The previous version was `el.play().catch(() => {})` and a `playing` boolean.
 * On a kiosk that is the worst case: a muted tablet, a blocked autoplay and a
 * missing file all look identical to the UI, which then narrates over silence.
 * Every station now knows whether sound actually happened.
 */
export function useAudio(src: string | undefined): AudioController {
  const ref = useRef<HTMLAudioElement | null>(null);
  const initialState = useMemo<PlaybackState>(
    () => (src ? { ...INITIAL_PLAYBACK, status: "loading" } : INITIAL_PLAYBACK),
    [src],
  );
  const [sourceState, setSourceState] = useState<{
    src: string | undefined;
    state: PlaybackState;
  }>(() => ({ src, state: initialState }));
  const state = sourceState.src === src ? sourceState.state : initialState;
  const setState = useCallback(
    (update: PlaybackState | ((current: PlaybackState) => PlaybackState)) => {
      setSourceState((current) => {
        const base = current.src === src ? current.state : initialState;
        return {
          src,
          state: typeof update === "function" ? update(base) : update,
        };
      });
    },
    [src, initialState],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;

    const duration = () => (Number.isFinite(el.duration) ? el.duration : null);

    const onLoadedMetadata = () =>
      setState((s) => ({ ...s, durationSec: duration() }));
    const onCanPlay = () =>
      setState((s) =>
        s.status === "loading"
          ? { ...s, status: "ready", error: null, durationSec: duration() }
          : s,
      );
    const onPlay = () =>
      setState((s) => ({ ...s, status: "playing", error: null, durationSec: duration() }));
    const onPause = () =>
      setState((s) => (s.status === "playing" ? { ...s, status: "ready" } : s));
    const onEnded = () => setState((s) => ({ ...s, status: "ended", progress: 1 }));
    const onTimeUpdate = () =>
      setState((s) => ({ ...s, progress: progressOf(el.currentTime, el.duration) }));
    const onError = () =>
      setState((s) => ({
        ...s,
        status: "error",
        error: mediaErrorToPlaybackError(el.error?.code),
      }));

    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("error", onError);

    // Already buffered (a cached clip fires `canplay` before this effect runs).
    if (el.readyState >= 3) onCanPlay();
    if (el.error) onError();

    /**
     * Runs on unmount AND whenever the source changes — the element is read
     * here, not captured at mount. The old cleanup captured `ref.current` at
     * mount time, so on Station 4 (where the element is created only once a
     * voice is chosen) it captured `null` and never stopped anything: switching
     * voices left the previous fake still talking underneath the new one.
     */
    return () => {
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("error", onError);
      el.pause();
      try {
        el.currentTime = 0;
      } catch {
        // Some browsers reject a seek before metadata; nothing to recover.
      }
    };
  }, [src, setState]);

  const startAt = useCallback(async (seconds: number): Promise<boolean> => {
    const el = ref.current;
    if (!el) return false;
    try {
      el.currentTime = seconds;
    } catch {
      // Seeking before metadata loads is fine to ignore; playback still starts.
    }
    setState((s) => ({
      ...s,
      error: null,
      progress: 0,
      status: s.status === "error" ? "loading" : s.status,
    }));
    try {
      await el.play();
      return true;
    } catch (reason: unknown) {
      const error = playRejectionToPlaybackError(reason);
      // An AbortError just means a newer clip interrupted this one.
      if (error !== "unknown") {
        setState((s) => ({ ...s, status: "error", error }));
      }
      return false;
    }
  }, [setState]);

  const play = useCallback(() => startAt(0), [startAt]);

  const seek = useCallback(
    (fraction: number) => {
      const el = ref.current;
      const total = el && Number.isFinite(el.duration) ? el.duration : 0;
      return startAt(Math.min(1, Math.max(0, fraction)) * total);
    },
    [startAt],
  );

  const stop = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      // See above.
    }
    setState((s) => ({ ...s, progress: 0 }));
  }, [setState]);

  return {
    ...state,
    ref,
    play,
    stop,
    seek,
    playing: state.status === "playing",
    loading: state.status === "loading",
    failed: state.status === "error",
  };
}
