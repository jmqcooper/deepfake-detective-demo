"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT, type Lang } from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import { BigButton, PersonaBubble, PlayButton, StationCard } from "@/components/kiosk/ui";
import { encodePcm16Wav, joinSamples } from "@/lib/wav";

type Phase = "ready" | "recording" | "review" | "cloning" | "result" | "error";
type ModelGuess = { label: "real" | "fake"; confidence: "low" | "medium" | "high" };
type ModelHealth = { ready?: boolean; loading?: boolean; error?: string | null };

const RECORD_SECONDS = 10;

export function Station5VoiceClone({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const t = useT(lang);
  const [phase, setPhase] = useState<Phase>("ready");
  const [seconds, setSeconds] = useState(RECORD_SECONDS);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [modelCheckAttempt, setModelCheckAttempt] = useState(0);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [cloneUrl, setCloneUrl] = useState<string | null>(null);
  const [guess, setGuess] = useState<ModelGuess | null>(null);
  const [playing, setPlaying] = useState<"reference" | "clone" | null>(null);
  const recordingBlob = useRef<Blob | null>(null);
  const stopRecording = useRef<((keepRecording: boolean) => void) | null>(null);
  const cloneRequest = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());

  const createObjectUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);
    return url;
  }, []);

  const releaseObjectUrl = useCallback((url: string): void => {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  const clearUrls = useCallback(() => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const check = async (): Promise<void> => {
      try {
        const response = await fetch("/api/voice-clone/health", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as ModelHealth | null;
        if (body?.ready === true) {
          setAvailable(true);
        } else if (body?.loading === true && !body.error) {
          setAvailable(null);
          timer = window.setTimeout(() => void check(), 2_000);
        } else {
          setAvailable(false);
        }
      } catch {
        if (!controller.signal.aborted) setAvailable(false);
      }
    };

    const wakeAndPoll = async (): Promise<void> => {
      try {
        const response = await fetch("/api/voice-clone/wake", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setAvailable(false);
          return;
        }
        await check();
      } catch {
        if (!controller.signal.aborted) setAvailable(false);
      }
    };

    void wakeAndPoll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [modelCheckAttempt]);

  useEffect(() => () => {
    stopRecording.current?.(false);
    cloneRequest.current?.abort();
    recordingBlob.current = null;
    clearUrls();
  }, [clearUrls]);

  const playUrl = useCallback((url: string, which: "reference" | "clone") => {
    const audio = new Audio(url);
    setPlaying(which);
    audio.onended = () => setPlaying(null);
    audio.onerror = () => setPlaying(null);
    void audio.play();
  }, []);

  const start = useCallback(async () => {
    try {
      clearUrls();
      recordingBlob.current = null;
      setReferenceUrl(null);
      setCloneUrl(null);
      setGuess(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silence = context.createGain();
      silence.gain.value = 0;
      const chunks: Float32Array[] = [];
      let recordingSampleRate = context.sampleRate;
      processor.onaudioprocess = (event) => {
        recordingSampleRate = event.inputBuffer.sampleRate;
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);

      let stopped = false;
      const finish = (keepRecording: boolean) => {
        if (stopped) return;
        stopped = true;
        processor.disconnect();
        source.disconnect();
        silence.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        stopRecording.current = null;
        if (keepRecording) {
          const blob = encodePcm16Wav(joinSamples(chunks), recordingSampleRate);
          recordingBlob.current = blob;
          setReferenceUrl(createObjectUrl(blob));
          setPhase("review");
        } else {
          chunks.length = 0;
          recordingBlob.current = null;
        }
      };
      stopRecording.current = finish;
      setSeconds(RECORD_SECONDS);
      setPhase("recording");
      announce(t("station5.recording"));
      window.setTimeout(() => finish(true), RECORD_SECONDS * 1000);
    } catch {
      setPhase("error");
    }
  }, [clearUrls, createObjectUrl, t]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const clone = useCallback(async () => {
    const audio = recordingBlob.current;
    if (!audio) return;
    const controller = new AbortController();
    cloneRequest.current = controller;
    setPhase("cloning");
    try {
      const form = new FormData();
      form.set("audio", audio, "participant.wav");
      form.set("lang", lang);
      const response = await fetch("/api/voice-clone", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("clone failed");
      const generated = await response.blob();
      const nextUrl = createObjectUrl(generated);
      setCloneUrl(nextUrl);
      const label = response.headers.get("x-echo-label");
      const confidence = response.headers.get("x-echo-confidence");
      setGuess(
        (label === "real" || label === "fake") &&
          (confidence === "low" || confidence === "medium" || confidence === "high")
          ? { label, confidence }
          : null,
      );
      setPhase("result");
      void playUrl(nextUrl, "clone");
    } catch {
      if (!controller.signal.aborted) setPhase("error");
    } finally {
      if (cloneRequest.current === controller) cloneRequest.current = null;
      recordingBlob.current = null;
      setReferenceUrl((current) => {
        if (current) releaseObjectUrl(current);
        return null;
      });
    }
  }, [createObjectUrl, lang, playUrl, releaseObjectUrl]);

  return (
    <StationCard>
      {available === false && phase === "ready" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <PersonaBubble who="echo">{t("station5.unavailable")}</PersonaBubble>
          <div className="flex flex-wrap justify-center gap-3">
            <BigButton
              onClick={() => {
                setAvailable(null);
                setModelCheckAttempt((attempt) => attempt + 1);
              }}
              tone="neutral"
            >
              {t("station5.retryModels")}
            </BigButton>
            <BigButton onClick={onDone} tone="echo">{t("common.next")}</BigButton>
          </div>
        </div>
      ) : phase === "ready" ? (
        <div className="flex flex-col items-center gap-5 py-4 text-center">
          <VoiceBars active={false} />
          <h2 className="text-2xl font-black text-white sm:text-4xl">{t("station5.title")}</h2>
          <p className="max-w-2xl text-lg font-extrabold text-white sm:text-2xl">“{t("station5.readText")}”</p>
          <p className="max-w-2xl text-base font-bold text-white/75 sm:text-lg">{t("station5.privacy")}</p>
          <BigButton onClick={() => void start()} tone="fake" disabled={available !== true}>
            {available === null ? t("station5.checking") : t("station5.start")}
          </BigButton>
        </div>
      ) : phase === "recording" ? (
        <div className="flex flex-col items-center gap-5 py-5 text-center">
          <VoiceBars active />
          <p className="font-mono text-5xl font-black text-fake-400 tnum">{seconds}</p>
          <p className="max-w-2xl text-xl font-extrabold text-white sm:text-3xl">“{t("station5.readText")}”</p>
          <p className="text-sm font-bold text-ink-400">{t("station5.recording")}</p>
        </div>
      ) : phase === "review" && referenceUrl ? (
        <div className="flex flex-col gap-5">
          <PersonaBubble who="echo">{t("station5.review")}</PersonaBubble>
          <div className="flex flex-wrap justify-center gap-3">
            <PlayButton onClick={() => playUrl(referenceUrl, "reference")} playing={playing === "reference"} label={t("station5.listenOriginal")} />
            <BigButton onClick={() => void start()} tone="neutral">{t("station5.again")}</BigButton>
            <BigButton onClick={() => void clone()} tone="fake">{t("station5.clone")}</BigButton>
          </div>
        </div>
      ) : phase === "cloning" ? (
        <div className="grid min-h-[22rem] place-items-center text-center">
          <div className="space-y-5"><VoiceBars active /><p className="text-2xl font-black text-white">{t("station5.cloning")}</p><p className="text-sm font-bold text-ink-400">{t("station5.wait")}</p></div>
        </div>
      ) : phase === "result" && cloneUrl ? (
        <div className="flex flex-col gap-5">
          <PersonaBubble who="echo" mood="alert" tone="alert">
            {guess ? t("station5.echoGuess", { label: t(guess.label === "real" ? "common.real" : "common.fake"), confidence: t(`station5.confidence.${guess.confidence}`) }) : t("station5.echoUnsure")}
          </PersonaBubble>
          <div className="rounded-[24px] bg-ink-800/75 p-5 text-center ring-1 ring-white/10 ring-inset">
            <p className="mb-4 text-lg font-extrabold text-white">{t("station5.cloneSays")}</p>
            <p className="mb-5 text-xl font-black text-fake-300 sm:text-2xl">“{t("station5.cloneText")}”</p>
            <PlayButton onClick={() => playUrl(cloneUrl, "clone")} playing={playing === "clone"} label={t("station5.listenClone")} />
          </div>
          <p className="text-center text-sm font-bold text-white/70">{t("station5.lesson")}</p>
          <div className="flex justify-end"><BigButton onClick={onDone} tone="echo">{t("common.next")}</BigButton></div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <PersonaBubble who="echo">{t("station5.error")}</PersonaBubble>
          <div className="flex gap-3"><BigButton onClick={() => { setPhase("ready"); }} tone="neutral">{t("audio.retry")}</BigButton><BigButton onClick={onDone} tone="echo">{t("common.next")}</BigButton></div>
        </div>
      )}
    </StationCard>
  );
}

function VoiceBars({ active }: { active: boolean }) {
  return <div className="flex h-20 items-center justify-center gap-2" aria-hidden>{Array.from({ length: 13 }, (_, i) => <span key={i} className={`w-2 rounded-full ${active ? "bg-fake-400" : "bg-echo-400/60"}`} style={{ height: `${24 + ((i * 47) % 68)}%`, animation: active ? `bar ${0.55 + (i % 4) * 0.13}s ease-in-out ${i * 0.05}s infinite` : undefined }} />)}</div>;
}
