"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Manifest } from "@/components/manifest-types";
import nl from "@/i18n/nl.json";
import en from "@/i18n/en.json";

export type Lang = "nl" | "en";

const DICTS: Record<Lang, unknown> = { nl, en };

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Dutch-first translator. Falls back to English, then to the key itself. */
export function useT(lang: Lang) {
  return useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const raw = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (m, k: string) =>
        k in vars ? String(vars[k]) : m,
      );
    },
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

function subscribeLang(onChange: () => void) {
  window.addEventListener(LANG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readLang(): Lang {
  const stored = window.localStorage.getItem("lang");
  return stored === "en" ? "en" : "nl";
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, readLang, () => "nl" as Lang);

  const set = useCallback((l: Lang) => {
    window.localStorage.setItem("lang", l);
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);

  return [lang, set];
}

export type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: Manifest }
  | { status: "missing" };

export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/samples/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no manifest"))))
      .then((m: Manifest) => {
        if (cancelled) return;
        if (!m?.clips?.length) {
          setState({ status: "missing" });
          return;
        }
        setState({ status: "ready", manifest: m });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Anonymous session id. Lives in memory only — a reset mints a new one, and
 * nothing about a visitor is ever correlated across sessions.
 */
export function useSession() {
  const [sessionId, setSessionId] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Math.random()).slice(2),
  );
  const reset = useCallback(() => setSessionId(crypto.randomUUID()), []);
  return { sessionId, reset };
}

export interface DemoEventInput {
  station: number;
  type: "station_enter" | "guess" | "station_complete" | "session_complete";
  clipId?: string;
  guess?: "real" | "fake";
  correct?: boolean;
  score?: number;
}

/**
 * Fire-and-forget telemetry. The kiosk must never stall or error because the
 * stats backend is down, so every failure is swallowed on purpose.
 */
export function useEvents(sessionId: string, lang: Lang) {
  return useCallback(
    (e: DemoEventInput) => {
      void fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...e, sessionId, lang }),
        keepalive: true,
      }).catch(() => {});
    },
    [sessionId, lang],
  );
}

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
 */
export function useBeat(delays: number[]): number {
  const [beat, setBeat] = useState(0);
  // The delay list is fixed per mount; callers remount (via key) to restart.
  const delaysRef = useRef(delays);

  useEffect(() => {
    const timers = delaysRef.current.map((d, i) =>
      setTimeout(() => setBeat(i + 1), d),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return beat;
}

/** Single shared <audio> element per component, with play-state tracking. */
export function useAudio(src: string | undefined) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onStop = () => {
      setPlaying(false);
      setProgress(0);
    };
    const onTime = () =>
      setProgress(el.duration ? el.currentTime / el.duration : 0);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onStop);
    el.addEventListener("timeupdate", onTime);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onStop);
      el.removeEventListener("timeupdate", onTime);
    };
  }, [src]);

  const play = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }, []);

  /**
   * Hard-stop on unmount. Without this a clip carries on sounding after the
   * station has changed — including when the idle timer resets the kiosk
   * mid-round, which would leave a disembodied voice playing over the attract
   * screen at the next visitor.
   */
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
    };
  }, []);

  return { ref, play, stop, playing, progress };
}
