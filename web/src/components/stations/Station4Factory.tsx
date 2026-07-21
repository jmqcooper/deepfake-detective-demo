"use client";

import { useEffect, useState } from "react";
import type {
  Clip,
  ClueBox,
  FactoryClip,
  FakeFactory,
} from "@/components/manifest-types";
import { useAudio, useBeat, useT, type Lang } from "@/components/kiosk/hooks";
import {
  BigButton,
  Panel,
  Persona,
  PersonaBubble,
  PlayButton,
  Spectrogram,
  StationCard,
  Typewriter,
} from "@/components/kiosk/ui";
import { IconFactory } from "@/components/kiosk/icons";

type Phase =
  | "sentence"
  | "voice"
  | "building"
  | "sent"
  | "listening"
  | "verdict"
  | "echo";

/**
 * Station 4 — "De nepstem-fabriek". The message the whole demo exists to land.
 *
 * The visitor picks a sentence and a voice, the machine builds the fake, and Miko
 * transcribes it *perfectly* and is delighted with himself. He has no idea it is
 * fake, because recognising words and detecting forgery are different jobs. Then
 * Echo takes one look and catches it.
 *
 * The choreography is strict, because this is a punchline and punchlines die
 * when the beats overlap: the machine builds, the message travels, Miko WRITES
 * WHILE THE AUDIO PLAYS, and only after his pen stops does his cheerful verdict
 * appear — followed, one tap later, by Echo's alarm. The old version printed
 * "Klinkt prima! Bericht ontvangen" before the clip had even started playing,
 * which gave the entire trick away above a still-typing transcript.
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
  const [clipMs, setClipMs] = useState(4000);

  const audioSrc = chosen ? chosen.audio : undefined;
  const { ref, play, playing } = useAudio(audioSrc);

  // Clips in the interface language when the pack has them; the original Dutch
  // set otherwise. Sentences are derived from the clips so their on-screen text
  // is in the language the voice actually speaks.
  const langClips = (() => {
    if (!usable) return [];
    const wanted = usable.clips.filter((c) => (c.lang ?? "nl") === lang);
    return wanted.length
      ? wanted
      : usable.clips.filter((c) => (c.lang ?? "nl") === "nl");
  })();
  const sentences = langClips
    .filter(
      (c, i) => langClips.findIndex((o) => o.sentenceId === c.sentenceId) === i,
    )
    .map((c) => ({ id: c.sentenceId, text: c.text, scam: c.scam }));

  const transcript =
    chosen && "transcript" in chosen ? (chosen.transcript ?? "") : "";
  const clue = chosen && "clue" in chosen ? chosen.clue : null;
  const spectrogram = chosen
    ? "spectrogram" in chosen && typeof chosen.spectrogram === "string"
      ? chosen.spectrogram
      : (chosen as Clip).spectrogram.image
    : "";

  // Theatre, in three beats: the machine "builds" (it's a lookup — the wait
  // sells the idea that making a fake voice is something a machine simply
  // does), the message travels to Miko, then Miko hears it and starts writing.
  useEffect(() => {
    if (phase === "building") {
      const timer = setTimeout(() => setPhase("sent"), 1600);
      return () => clearTimeout(timer);
    }
    if (phase === "sent") {
      const timer = setTimeout(() => {
        // Freeze the clip length NOW so the typewriter's pace can't change
        // mid-line if audio metadata resolves late.
        const dur = ref.current?.duration;
        setClipMs(dur && isFinite(dur) && dur > 0 ? dur * 1000 : 4000);
        setPhase("listening");
      }, 1100);
      return () => clearTimeout(timer);
    }
    if (phase === "listening") {
      const timer = setTimeout(() => play(), 300);
      return () => clearTimeout(timer);
    }
  }, [phase, play, ref]);

  // Tap = hear your fake before you commit — crafting the deception is the fun
  // part, and hearing it first makes "send to Miko" a deliberate act.
  const preview = (clip: FactoryClip | Clip) => {
    setChosen(clip);
    setTimeout(() => play(), 150);
  };

  const send = () => {
    if (chosen) setPhase("building");
  };

  const voicesFor = (sid: string) => langClips.filter((c) => c.sentenceId === sid);

  return (
    <StationCard>
      {audioSrc && <audio ref={ref} src={audioSrc} preload="auto" />}

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
                className="rise flex items-center gap-3 rounded-[20px] bg-ink-800/80 p-5 text-left ring-1 ring-white/[0.06] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] ring-inset hover:bg-ink-700 active:scale-[0.96]"
              >
                <span className="text-lg font-bold text-white/90">
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
          <div className="mx-auto grid w-full max-w-2xl gap-4 sm:grid-cols-2">
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
                  style={{ animationDelay: `${120 + i * 90}ms` }}
                  className={`rise flex flex-col items-center gap-3 rounded-[24px] p-6 ring-inset transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] ${
                    selected
                      ? "bg-ink-700 ring-2 ring-fake-400"
                      : "bg-ink-800/80 ring-1 ring-white/[0.06] hover:bg-ink-700"
                  }`}
                >
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-fake-500/15 text-fake-400">
                    {selected && playing ? <PlayingBars /> : <IconFactory size={30} />}
                  </span>
                  <span className="font-display text-xl font-extrabold">
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
        <div className="grid min-h-[24rem] place-items-center">
          <div className="flex flex-col items-center gap-6">
            {phase === "building" ? (
              <span className="breathe grid h-24 w-24 place-items-center rounded-[28px] bg-fake-500/15 text-fake-400">
                <IconFactory size={48} />
              </span>
            ) : (
              <Persona who="miko" size={96} mood="listening" className="breathe" />
            )}
            <p className="font-display text-2xl font-extrabold text-white/85">
              {phase === "building"
                ? t("station4.building")
                : t("station4.sending")}
            </p>
            <div className="h-1.5 w-72 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full w-1/3 rounded-full bg-fake-500"
                style={{ animation: "scan 1.4s ease-in-out infinite" }}
              />
            </div>
          </div>
        </div>
      )}

      {(phase === "listening" || phase === "verdict" || phase === "echo") &&
        chosen && (
          <div className="flex flex-col gap-5">
            <Panel className="rise flex items-center gap-4 p-5 ring-miko-400/25">
              <Persona
                who="miko"
                size={78}
                mood={phase === "listening" ? "listening" : "happy"}
                className="breathe shrink-0"
              />
              <div className="flex-1">
                <p className="mb-1 font-mono text-[11px] font-bold tracking-[0.16em] text-miko-400 uppercase">
                  {t("station4.mikoHeard")}
                </p>
                <p className="text-xl font-bold text-white md:text-2xl">
                  “
                  <Typewriter
                    key={chosen.id}
                    text={transcript || t("station4.noTranscript")}
                    totalMs={clipMs}
                    onDone={() =>
                      setPhase((p) => (p === "listening" ? "verdict" : p))
                    }
                  />
                  ”
                </p>
                {/* Miko's cheerful all-clear may only appear once he has finished
                    writing — it IS the joke, and it must not precede the setup. */}
                <p className="mt-2 min-h-7 text-lg font-bold text-miko-300">
                  {phase !== "listening" && (
                    <span className="rise inline-block">
                      {t("station4.mikoVerdict")}
                    </span>
                  )}
                </p>
              </div>
            </Panel>

            {phase === "verdict" && (
              <div className="rise flex flex-wrap items-center justify-between gap-4">
                <PlayButton
                  onClick={play}
                  playing={playing}
                  tone="miko"
                  label={t("common.listen")}
                />
                <BigButton onClick={() => setPhase("echo")} tone="echo">
                  {t("station4.askEcho")}
                </BigButton>
              </div>
            )}

            {phase === "echo" && (
              <EchoVerdict
                lang={lang}
                spectrogram={spectrogram}
                clue={clue ?? null}
                scam={"scam" in chosen && chosen.scam}
                onDone={onDone}
              />
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

/**
 * Echo's catch, beat by beat: the alarm, then the evidence, then — after the
 * visitor has felt the trick land — the one sentence the whole demo is for.
 */
function EchoVerdict({
  lang,
  spectrogram,
  clue,
  scam,
  onDone,
}: {
  lang: Lang;
  spectrogram: string;
  clue: ClueBox | null;
  scam: boolean;
  onDone: () => void;
}) {
  const t = useT(lang);
  const beat = useBeat([600, 1600, 2400]);

  return (
    <>
      <PersonaBubble who="echo" mood="alert" tone="alert">
        {t("station4.echoAlert")}
      </PersonaBubble>

      {beat >= 1 && (
        <Spectrogram
          image={spectrogram}
          clue={clue}
          showClue={Boolean(clue)}
          scanning
          className="h-44 w-full"
          caption={t("station2.evidence")}
        />
      )}

      {beat >= 2 && (
        <>
          {/* If they picked the scam sentence, Echo gives the one piece of advice
              that actually protects a family. This is the whole reason that
              sentence is in the demo. */}
          {scam && (
            <div className="rise rounded-[20px] bg-fake-500/10 p-5 ring-1 ring-fake-500/40 ring-inset">
              <p className="text-lg font-bold text-fake-400">
                {t("station4.scamTip")}
              </p>
            </div>
          )}

          {/* The thesis of the entire demo, stated once, plainly, after the
              visitor has already felt it. */}
          <div className="rise rounded-[24px] bg-gradient-to-br from-echo-500/20 via-ink-800/40 to-miko-500/20 p-6 text-center ring-1 ring-white/10 ring-inset">
            <p className="font-display text-2xl leading-snug font-extrabold text-white md:text-[1.8rem]">
              {t("station4.lesson")}
            </p>
          </div>
        </>
      )}

      <div className="flex min-h-[4.75rem] justify-end">
        {beat >= 3 && (
          <BigButton onClick={onDone} tone="echo" className="rise">
            {t("common.next")}
          </BigButton>
        )}
      </div>
    </>
  );
}
