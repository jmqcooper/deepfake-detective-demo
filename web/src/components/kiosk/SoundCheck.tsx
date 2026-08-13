"use client";

import { useCallback, useState } from "react";
import type { Clip } from "@/components/manifest-types";
import { useAudio, useT, type Lang } from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import {
  BigButton,
  Panel,
  Persona,
  PersonaBubble,
  PlayButton,
  StationCard,
} from "@/components/kiosk/ui";
import { isReportableError, playbackErrorKey } from "@/lib/audio-state";

/**
 * The thirty seconds that save the whole demo.
 *
 * Every station after this one is audio. A tablet on silent, a browser that
 * blocks autoplay, headphones in the wrong socket, a pack that never generated
 * — all of them produce the same experience: a visitor watching an animated
 * spectrogram of nothing, being asked to judge a voice they never heard, and
 * concluding that the exhibit is broken or that they are.
 *
 * So: one real clip from the pack, played on an explicit tap (never autoplay,
 * which is exactly the thing that cannot be relied on), and one honest
 * question. "I hear it" moves on. "I hear nothing" gets the four things that
 * are actually wrong, in the order they are usually wrong, and a way to try
 * again — plus a way past, because a visitor must never be trapped at the door.
 */
export function SoundCheck({
  lang,
  clip,
  onDone,
}: {
  lang: Lang;
  clip: Clip | undefined;
  onDone: (heard: boolean) => void;
}) {
  const t = useT(lang);
  const {
    ref: audioRef,
    play: playAudio,
    playing,
    error: audioError,
  } = useAudio(clip?.audio);
  const [tried, setTried] = useState(false);
  const [troubleshooting, setTroubleshooting] = useState(false);

  const playSample = useCallback(async () => {
    setTried(true);
    const started = await playAudio();
    if (!started) setTroubleshooting(true);
  }, [playAudio]);

  const confirmHeard = useCallback(() => {
    announce(t("soundcheck.confirmed"));
    onDone(true);
  }, [onDone, t]);

  const reportSilence = useCallback(() => {
    setTroubleshooting(true);
    announce(t("soundcheck.tipsTitle"), "assertive");
  }, [t]);

  // A pack that never generated is a setup problem, not a volume problem, and
  // saying "turn your sound up" to an operator whose files are missing wastes
  // their morning. The element's own error tells us which one it is.
  const playbackError = isReportableError(audioError) ? audioError : null;
  const errorMessage = playbackError ? t(playbackErrorKey(playbackError)) : null;

  return (
    <StationCard>
      {/* Always in the tree: an element that only appears once a clip resolves
          would have its listeners attached after the first playback attempt. */}
      <audio ref={audioRef} src={clip?.audio} preload="auto" />

      <PersonaBubble who="miko" mood={playing ? "listening" : "idle"}>
        {t("soundcheck.intro")}
      </PersonaBubble>

      <Panel className="flex flex-col items-center gap-5 p-5 text-center sm:p-6">
        <Persona
          who="miko"
          size={84}
          mood={playing ? "listening" : "idle"}
          className="breathe"
        />
        <h2 className="text-xl font-black text-white sm:text-2xl">
          {t("soundcheck.title")}
        </h2>
        <p className="max-w-lg text-sm font-semibold text-white/75 sm:text-base">
          {t("soundcheck.body")}
        </p>

        <PlayButton
          onClick={() => void playSample()}
          playing={playing}
          tone="miko"
          label={tried ? t("soundcheck.playAgain") : t("soundcheck.play")}
          disabled={!clip}
        />

        {errorMessage && (
          <p
            className="max-w-lg rounded-[16px] bg-fake-500/10 p-4 text-sm font-bold text-fake-400 ring-1 ring-fake-500/40 ring-inset"
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        {/* The question only appears once something has actually been asked to
            play. Asking "can you hear it?" before anything played is how you
            teach a visitor to click past a broken exhibit. */}
        {tried && (
          <div className="rise flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
            <BigButton onClick={confirmHeard} tone="real">
              {t("soundcheck.heard")}
            </BigButton>
            <BigButton onClick={reportSilence} tone="neutral">
              {t("soundcheck.silent")}
            </BigButton>
          </div>
        )}
      </Panel>

      {troubleshooting && (
        <div className="rise rounded-[20px] bg-ink-800/70 p-5 ring-1 ring-white/[0.06] ring-inset">
          <p className="mb-3 font-mono text-[11px] font-bold tracking-[0.16em] text-miko-400 uppercase">
            {t("soundcheck.tipsTitle")}
          </p>
          <ul className="space-y-2 text-sm font-semibold text-white/80 sm:text-base">
            {["tip1", "tip2", "tip3", "tip4"].map((key) => (
              <li key={key} className="flex gap-2">
                <span aria-hidden className="text-miko-400">
                  •
                </span>
                <span>{t(`soundcheck.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Never a dead end. Someone can be deaf, or in a hall too loud to
            check, and the demo still has to let them through. */}
        <button
          type="button"
          onClick={() => onDone(false)}
          className="min-h-11 rounded-[14px] px-4 text-left text-sm font-bold text-ink-400 underline underline-offset-4 transition-colors hover:text-white"
        >
          {t("soundcheck.continueAnyway")}
        </button>
        {tried && (
          <BigButton onClick={confirmHeard} tone="echo">
            {t("soundcheck.start")}
          </BigButton>
        )}
      </div>
    </StationCard>
  );
}
