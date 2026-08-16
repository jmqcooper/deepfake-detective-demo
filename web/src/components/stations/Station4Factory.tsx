"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Clip, FactoryClip, FakeFactory } from "@/components/manifest-types";
import { useAudio, useT, type Lang } from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import {
  AudioProblem,
  BigButton,
  Panel,
  Persona,
  PersonaBubble,
  PlayButton,
  StationCard,
  Typewriter,
} from "@/components/kiosk/ui";
import { IconFactory } from "@/components/kiosk/icons";
import { isReportableError, playbackErrorKey } from "@/lib/audio-state";

type Phase =
  | "sentence"
  | "voice"
  | "building"
  | "sent"
  | "listening"
  | "verdict";

const BUILD_MS = 1600;
const SEND_MS = 1100;

/**
 * Station 4 — "De nepstem-fabriek". The message the whole demo exists to land.
 *
 * The visitor picks a sentence and a voice, the machine builds the fake, and Miko
 * transcribes it *perfectly* and is delighted with himself. He has no idea it is
 * fake, because recognising words and detecting forgery are different jobs. Then
 * Echo explains why understanding the words says little about who made them.
 *
 * The choreography is strict, because this is a punchline and punchlines die
 * when the beats overlap: the machine builds, the message travels, Miko WRITES
 * WHILE THE AUDIO PLAYS, and only after his pen stops does his cheerful verdict
 * appear, followed by the lesson.
 *
 * And the choreography is driven by the audio element, not by a timer. It used
 * to run on `setTimeout`, so on a muted tablet or a missing file Miko would
 * transcribe a clip nobody heard and cheerfully declare it fine — the demo
 * performing its own punchline to an empty room. Now the pen only moves while
 * the clip is playing, and the verdict only lands when it has ended.
 *
 * Everything on this screen has to be genuine or the lesson is a lie:
 *  - the audio is real Voxtral TTS output, not a sound effect;
 *  - the transcript is the real ASR's output, not written by us.
 */
export function Station4Factory({
  factory,
  fallbackFakes,
  lang,
  onDone,
}: {
  factory: FakeFactory | undefined;
  fallbackFakes: Clip[];
  lang: Lang;
  onDone: () => void;
}) {
  const t = useT(lang);
  const usable = factory?.available && factory.clips.length > 0 ? factory : null;

  const [phase, setPhase] = useState<Phase>(usable ? "sentence" : "voice");
  const [sentenceId, setSentenceId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<FactoryClip | Clip | null>(null);

  const audioSrc = chosen?.audio;
  const {
    ref: audioRef,
    play,
    playing,
    status,
    durationSec,
    error: audioError,
  } = useAudio(audioSrc);

  // Clips in the interface language when the pack has them; the original Dutch
  // set otherwise. Sentences are derived from the clips so their on-screen text
  // is in the language the voice actually speaks.
  const langClips = useMemo(() => {
    if (!usable) return [];
    const wanted = usable.clips.filter((c) => (c.lang ?? "nl") === lang);
    return wanted.length
      ? wanted
      : usable.clips.filter((c) => (c.lang ?? "nl") === "nl");
  }, [usable, lang]);

  const sentences = langClips
    .filter(
      (c, i) => langClips.findIndex((o) => o.sentenceId === c.sentenceId) === i,
    )
    .map((c) => ({ id: c.sentenceId, text: c.text, scam: c.scam }));

  const transcript =
    chosen && "transcript" in chosen ? (chosen.transcript ?? "") : "";
  const requested = chosen && "text" in chosen ? chosen.text : "";

  // Theatre, in two beats: the machine "builds" (it's a lookup — the wait
  // sells the idea that making a fake voice is something a machine simply
  // does), then the message travels to Miko. Both are pure staging with no
  // audio behind them, so timers are the honest mechanism here.
  useEffect(() => {
    if (phase === "building") {
      const timer = setTimeout(() => setPhase("sent"), BUILD_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "sent") {
      const timer = setTimeout(() => setPhase("listening"), SEND_MS);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  /**
   * True once this beat's playback has genuinely started. Needed because the
   * visitor almost always previews the clip first, which leaves the element in
   * `ended` — without this the punchline would fire the instant the message
   * "arrived", off the back of a clip they heard a minute ago.
   */
  const heardStart = useRef(false);

  // Entering the listening beat: start the clip, once. `play` is stable, so a
  // failure does not re-trigger this — retrying on every status change would
  // loop forever, since play() moves the status to loading and back to error.
  useEffect(() => {
    if (phase !== "listening") return;
    heardStart.current = false;
    const timer = setTimeout(() => void play(), 300);
    return () => clearTimeout(timer);
  }, [phase, play]);

  /**
   * The punchline is gated on the clip actually finishing. `ended` after a real
   * `playing` means sound happened; a blocked or missing clip leaves the phase
   * where it is and shows the problem instead, so Miko never declares a message
   * fine that nobody has heard.
   */
  useEffect(() => {
    if (phase !== "listening") return;
    if (status === "playing") {
      heardStart.current = true;
      return;
    }
    if (status === "ended" && heardStart.current) {
      setPhase("verdict");
      announce(t("station4.mikoVerdict"));
    }
  }, [phase, status, t]);

  // Tap = hear your fake before you commit — crafting the deception is the fun
  // part, and hearing it first makes "send to Miko" a deliberate act. Tapping
  // the one already selected replays it rather than doing nothing.
  const preview = useCallback(
    (clip: FactoryClip | Clip) => {
      if (chosen?.id === clip.id) {
        void play();
        return;
      }
      setChosen(clip);
    },
    [chosen, play],
  );

  // A newly chosen clip previews itself once its element has the new source.
  useEffect(() => {
    if (phase !== "voice" || !audioSrc) return;
    const timer = setTimeout(() => void play(), 150);
    return () => clearTimeout(timer);
  }, [audioSrc, phase, play]);

  const send = () => {
    if (chosen) setPhase("building");
  };

  const voicesFor = (sid: string) => langClips.filter((c) => c.sentenceId === sid);
  const playbackError = isReportableError(audioError) ? audioError : null;
  const listening = phase === "listening";

  return (
    <StationCard>
      {/* Always rendered, so the element (and its cleanup) exists from the
          start. Rendering it conditionally meant the very first playback
          attached its listeners to an element that had only just appeared. */}
      <audio ref={audioRef} src={audioSrc} preload="auto" />

      {/* Step 1 — choose what the fake voice will SAY. */}
      {phase === "sentence" && usable && (
        <>
          <PersonaBubble who="echo">{t("station4.pickSentence")}</PersonaBubble>
          <div className="grid gap-3 md:grid-cols-2">
            {sentences.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSentenceId(s.id);
                  setChosen(null);
                  setPhase("voice");
                }}
                style={{ animationDelay: `${100 + i * 70}ms` }}
                className="rise flex min-h-14 items-center gap-3 rounded-[20px] bg-ink-800/80 p-4 text-left ring-1 ring-white/[0.06] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] ring-inset hover:bg-ink-700 active:scale-[0.96] sm:p-5"
              >
                <span className="text-base font-bold text-white/90 sm:text-lg">
                  “{s.text}”
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Step 2 — choose WHOSE voice says it. Tap to hear the fake; the send
          button appears once something is chosen. */}
      {phase === "voice" && (
        <>
          <PersonaBubble who="echo">{t("station4.pickVoice")}</PersonaBubble>

          {playbackError && (
            <AudioProblem
              lang={lang}
              message={t(playbackErrorKey(playbackError))}
              onRetry={() => void play()}
              retryLabel={t("audio.retry")}
            />
          )}

          <div className="mx-auto grid w-full max-w-2xl gap-3 sm:grid-cols-2 sm:gap-4">
            {(usable && sentenceId
              ? voicesFor(sentenceId)
              : fallbackFakes.slice(0, 2)
            ).map((clip, i) => {
              const selected = chosen?.id === clip.id;
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => preview(clip)}
                  aria-pressed={selected}
                  style={{ animationDelay: `${120 + i * 90}ms` }}
                  className={`rise flex flex-col items-center gap-3 rounded-[24px] p-5 ring-inset transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] sm:p-6 ${
                    selected
                      ? "bg-ink-700 ring-2 ring-fake-400"
                      : "bg-ink-800/80 ring-1 ring-white/[0.06] hover:bg-ink-700"
                  }`}
                >
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-fake-500/15 text-fake-400">
                    {selected && playing ? <PlayingBars /> : <IconFactory size={30} />}
                  </span>
                  <span className="font-display text-lg font-extrabold sm:text-xl">
                    {"voice" in clip
                      ? t(`voice.${clip.voice}`)
                      : t(`station4.voice${i + 1}`)}
                  </span>
                  <span className="text-sm text-ink-400">
                    {t("station4.pickHint")}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex min-h-[4.75rem] justify-center">
            {chosen && (
              <BigButton onClick={send} tone="fake" className="rise">
                {t("station4.send")}
              </BigButton>
            )}
          </div>
        </>
      )}

      {(phase === "building" || phase === "sent") && (
        <div className="grid min-h-[18rem] place-items-center sm:min-h-[24rem]">
          <div className="flex flex-col items-center gap-5 sm:gap-6">
            {phase === "building" ? (
              <span className="breathe grid h-20 w-20 place-items-center rounded-[28px] bg-fake-500/15 text-fake-400 sm:h-24 sm:w-24">
                <IconFactory size={48} />
              </span>
            ) : (
              <Persona who="miko" size={88} mood="listening" className="breathe" />
            )}
            <p className="text-center font-display text-xl font-extrabold text-white/85 sm:text-2xl">
              {phase === "building"
                ? t("station4.building")
                : t("station4.sending")}
            </p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full w-1/3 rounded-full bg-fake-500"
                style={{ animation: "scan 1.4s ease-in-out infinite" }}
              />
            </div>
          </div>
        </div>
      )}

      {(phase === "listening" || phase === "verdict") &&
        chosen && (
          <div className="flex flex-col gap-4 sm:gap-5">
            {playbackError && (
              <AudioProblem
                lang={lang}
                message={t(playbackErrorKey(playbackError))}
                onRetry={() => void play()}
                retryLabel={t("audio.retry")}
              />
            )}

            {/* Gating the punchline on real playback is right; trapping the
                visitor behind a clip that will never play is not. This is the
                way out, and it says plainly that the sound was skipped. */}
            {playbackError && listening && (
              <div className="flex justify-center">
                <BigButton onClick={() => setPhase("verdict")} tone="neutral">
                  {t("audio.continueWithout")}
                </BigButton>
              </div>
            )}

            <Panel className="rise flex items-center gap-3 p-4 ring-miko-400/25 sm:gap-4 sm:p-5">
              <Persona
                who="miko"
                size={64}
                mood={listening ? "listening" : "happy"}
                className="breathe hidden shrink-0 sm:block"
              />
              <div className="min-w-0 flex-1">
                <p className="mb-1 font-mono text-[11px] font-bold tracking-[0.16em] text-miko-400 uppercase">
                  {t("station4.mikoHeard")}
                </p>
                <p className="text-lg font-bold text-white sm:text-xl md:text-2xl">
                  “
                  <Typewriter
                    key={chosen.id}
                    text={transcript || t("station4.noTranscript")}
                    totalMs={(durationSec ?? 4) * 1000}
                    /* The pen stops when the sound does. Nothing here should
                       ever describe audio that is not actually playing. */
                    paused={listening && !playing}
                  />
                  ”
                </p>
                {/* Miko's cheerful all-clear may only appear once he has finished
                    listening — it IS the joke, and it must not precede the setup. */}
                <p className="mt-2 min-h-7 text-base font-bold text-miko-300 sm:text-lg">
                  {phase !== "listening" && (
                    <span className="rise inline-block">
                      {t("station4.mikoVerdict")}
                    </span>
                  )}
                </p>
              </div>
            </Panel>

            {/* What you asked for versus what the recogniser came back with.
                Both are in the pack; neither is written by us. On this station
                they usually match almost exactly, which is the entire point. */}
            {phase !== "listening" && requested && (
              <div className="rise grid gap-2 sm:grid-cols-2">
                <div className="min-w-0 rounded-[16px] bg-ink-800/60 p-3">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-400 uppercase">
                    {t("station4.youAskedFor")}
                  </p>
                  <p className="mt-1 text-sm font-bold text-white/85">“{requested}”</p>
                </div>
                <div className="min-w-0 rounded-[16px] bg-ink-800/60 p-3">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-400 uppercase">
                    {t("station4.mikoWrote")}
                  </p>
                  <p className="mt-1 text-sm font-bold text-white/85">
                    “{transcript || t("station4.noTranscript")}”
                  </p>
                </div>
              </div>
            )}

            {phase === "verdict" && (
              <>
                <PersonaBubble who="echo" mood="alert" tone="alert">
                  {t("station4.lesson")}
                </PersonaBubble>
                {"scam" in chosen && chosen.scam && (
                  <div className="rise rounded-[20px] bg-fake-500/10 p-4 ring-1 ring-fake-500/40 ring-inset sm:p-5">
                    <p className="text-base font-bold text-fake-400 sm:text-lg">
                      {t("station4.scamTip")}
                    </p>
                  </div>
                )}
                <div className="rise flex flex-wrap items-center justify-between gap-3 sm:gap-4">
                  <PlayButton
                    onClick={() => void play()}
                    playing={playing}
                    tone="miko"
                    label={t("common.listen")}
                  />
                  <BigButton onClick={onDone} tone="echo">
                    {t("common.next")}
                  </BigButton>
                </div>
              </>
            )}
          </div>
        )}
    </StationCard>
  );
}

/** Tiny equaliser shown inside the selected voice card while it previews. */
function PlayingBars() {
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
