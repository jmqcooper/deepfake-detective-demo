"use client";

import { useCallback, useState } from "react";
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
} from "@/components/kiosk/ui";
import { isReportableError, playbackErrorKey } from "@/lib/audio-state";
import {
  FINAL_SCENARIO_CHOICES,
  type FinalScenarioChoice,
} from "@/lib/final-scenario";

/**
 * The one thing worth taking home.
 *
 * Everything before this station trains an ear and an eye on a curated set of
 * clips. None of it survives contact with a real phone call: the fakes get
 * better every month, the good ones already include breaths and room noise, and
 * nobody has a spectrogram at the kitchen table. What does survive is a habit.
 *
 * The message is deliberately anonymous — no name, no relationship, no
 * photograph. It is the voice of "someone you know", because the moment a demo
 * names a person it invites a child to picture that person lying to them, and
 * because the advice is the same whoever it is.
 *
 * Four answers, and the interesting one is not the correct one:
 *
 *  - `reply` is the trap. Answering in the same channel *feels* like checking,
 *    and it verifies nothing at all: whoever is on that channel is precisely
 *    the thing in question, and a voice clone can answer a question.
 *  - `unsure` is a real answer, not a cop-out. "I don't know" is the honest
 *    state most people are in, and it leads to exactly the same action, which
 *    is the reassuring part.
 *  - `callback` is correct because it does not require you to have detected
 *    anything. That is the whole point: the action works even when your ears
 *    were fooled — which, after the last four stations, the visitor now knows
 *    they can be.
 */
export function FinalScenario({
  lang,
  message,
  onAnswer,
  onDone,
}: {
  lang: Lang;
  /** A real clip from the pack, plus the sentence it actually says. */
  message: { audio: string; text: string } | undefined;
  /** Resolves the server's verdict for the chosen action. */
  onAnswer: (choice: FinalScenarioChoice) => Promise<boolean>;
  onDone: (verifiedFirst: boolean) => void;
}) {
  const t = useT(lang);
  const {
    ref: audioRef,
    play: playAudio,
    playing,
    error: audioError,
  } = useAudio(message?.audio);
  const [choice, setChoice] = useState<FinalScenarioChoice | null>(null);
  const [wasRight, setWasRight] = useState(false);

  const answer = useCallback(
    async (picked: FinalScenarioChoice) => {
      if (choice !== null) return;
      setChoice(picked);
      const correct = await onAnswer(picked);
      setWasRight(correct);
      announce(
        `${t(correct ? "final.right" : "final.wrong")} ${t(`final.why.${picked}`)}`,
        "assertive",
      );
    },
    [choice, onAnswer, t],
  );

  const playbackError = isReportableError(audioError) ? audioError : null;

  return (
    <StationCard>
      <audio ref={audioRef} src={message?.audio} preload="auto" />

      <PersonaBubble who="echo" mood={choice === null ? "listening" : "alert"}>
        {t("final.intro")}
      </PersonaBubble>

      <Panel className="flex flex-col gap-4 p-4 sm:p-6">
        <p className="font-mono text-[11px] font-bold tracking-[0.16em] text-fake-400 uppercase">
          {t("final.kicker")}
        </p>
        <h2 className="text-xl font-black text-white sm:text-2xl">
          {t("final.title")}
        </h2>
        <p className="text-sm leading-relaxed font-semibold text-white/80 sm:text-base">
          {t("final.body")}
        </p>

        {/* A real voice message from the pack — the same kind of fake the
            visitor built one station ago. Nothing new is generated here. */}
        <div className="flex flex-wrap items-center gap-3">
          <Persona
            who="miko"
            size={48}
            mood={playing ? "listening" : "idle"}
            className="shrink-0"
          />
          <PlayButton
            onClick={() => void playAudio()}
            playing={playing}
            tone="miko"
            label={t("final.playMessage")}
            disabled={!message}
          />
        </div>

        {playbackError && (
          <AudioProblem
            lang={lang}
            message={t(playbackErrorKey(playbackError))}
            onRetry={() => void playAudio()}
            retryLabel={t("audio.retry")}
          />
        )}

        {/* The message in words too — the sentence that clip genuinely says, so
            nobody has to take the story's word for it. The decision this
            station teaches does not depend on hearing anything, and neither
            should the question. */}
        {message && (
          <blockquote className="rounded-[16px] bg-ink-900/70 p-4 text-sm leading-relaxed font-bold text-white/85 sm:text-base">
            “{message.text}”
          </blockquote>
        )}
      </Panel>

      {choice === null ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-base font-black text-white sm:text-lg">
            {t("final.question")}
          </legend>
          {FINAL_SCENARIO_CHOICES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => void answer(option)}
              className="flex min-h-14 w-full items-center rounded-[20px] bg-ink-800/80 p-4 text-left text-sm font-bold text-white/90 ring-1 ring-white/[0.06] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] ring-inset hover:bg-ink-700 active:scale-[0.98] sm:text-base"
            >
              {t(`final.option.${option}`)}
            </button>
          ))}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-4">
          <div
            className={`rise rounded-[20px] p-4 ring-1 ring-inset sm:p-5 ${
              wasRight
                ? "bg-real-500/10 ring-real-500/40"
                : "bg-miko-500/10 ring-miko-500/40"
            }`}
          >
            <p
              className={`mb-1 font-mono text-[11px] font-bold tracking-[0.16em] uppercase ${
                wasRight ? "text-real-400" : "text-miko-400"
              }`}
            >
              {t(wasRight ? "final.right" : "final.wrong")}
            </p>
            <p className="text-sm leading-relaxed font-bold text-white/90 sm:text-base">
              {t(`final.why.${choice}`)}
            </p>
          </div>

          {/* The takeaway, stated the same way regardless of which answer was
              chosen. Someone who got it wrong needs it more, not less. */}
          <div className="rise rounded-[24px] bg-gradient-to-br from-echo-500/20 via-ink-800/40 to-miko-500/20 p-5 text-center ring-1 ring-white/10 ring-inset sm:p-6">
            <p className="font-display text-lg leading-snug font-extrabold text-white sm:text-2xl">
              {t("final.takeaway")}
            </p>
          </div>

          <div className="flex justify-end">
            <BigButton onClick={() => onDone(wasRight)} tone="echo">
              {t("final.toDiploma")}
            </BigButton>
          </div>
        </div>
      )}
    </StationCard>
  );
}
