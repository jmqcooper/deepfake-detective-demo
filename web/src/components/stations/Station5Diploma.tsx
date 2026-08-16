"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT, type Lang, type TrackFn } from "@/components/kiosk/hooks";
import { announce } from "@/components/kiosk/announcer";
import { Badge, BigButton, PersonaBubble, StationCard } from "@/components/kiosk/ui";
import { FinalScenario } from "@/components/stations/FinalScenario";
import {
  IconBrain,
  IconEar,
  IconFactory,
  IconHandshake,
  IconMagnifier,
  IconPhone,
  IconSlider,
} from "@/components/kiosk/icons";
import type { SummaryStats } from "@/lib/stats";
import type { FinalScenarioChoice } from "@/lib/final-scenario";

/**
 * Station 6: the last test, then the diploma.
 *
 * The most important element on this screen is not the score, it's the crowd
 * stat: "62% of visitors fell for that one too". For a general audience the
 * reassurance that being fooled is normal is the whole take-home — a visitor who
 * leaves feeling stupid has learned nothing useful.
 *
 * The scenario comes first, and it is the only part of the demo that transfers.
 * Everything before it teaches a visitor to notice something about a
 * spectrogram, which is a museum skill. This teaches what to do when a voice
 * they love asks them for money, which is the one that matters at home.
 */
export function Station6Diploma({
  score,
  total,
  lang,
  track,
  scamMessage,
  onScoreChange,
  onRestart,
}: {
  score: number;
  total: number;
  lang: Lang;
  track: TrackFn;
  /** A real scam clip from the pack, plus the sentence it actually says. */
  scamMessage: { audio: string; text: string } | undefined;
  onScoreChange: (score: number) => void;
  onRestart: () => void;
}) {
  const t = useT(lang);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [scenarioDone, setScenarioDone] = useState(false);
  const [verifiedFirst, setVerifiedFirst] = useState(false);
  const completionSent = useRef(false);

  /**
   * The visit is closed out here, and the score written down is the server's
   * own tally of the guesses it accepted — not a number this component was
   * handed. The response carries that tally back so the diploma shows the same
   * figure the exhibit reports.
   */
  useEffect(() => {
    if (!scenarioDone || completionSent.current) return;
    completionSent.current = true;
    let cancelled = false;
    void (async () => {
      const response = await track({ station: 6, type: "session_complete" });
      if (cancelled || !response) return;
      onScoreChange(response.session.correct);
    })();
    return () => {
      cancelled = true;
    };
  }, [onScoreChange, scenarioDone, track]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/stats/summary", {
          signal: controller.signal,
        });
        if (!response.ok) return;
        setSummary((await response.json()) as SummaryStats);
      } catch {
        // No stats is a supported state, not a failure worth showing.
      }
    })();
    return () => controller.abort();
  }, []);

  const onScenarioAnswer = useCallback(
    async (choice: FinalScenarioChoice) => {
      const response = await track({ station: 6, type: "final_scenario", choice });
      return response?.scenario?.correct ?? choice === "callback";
    },
    [track],
  );

  if (!scenarioDone) {
    return (
      <FinalScenario
        lang={lang}
        message={scamMessage}
        onAnswer={onScenarioAnswer}
        onDone={(wasRight) => {
          setVerifiedFirst(wasRight);
          setScenarioDone(true);
          announce(t("station6.title"));
        }}
      />
    );
  }

  const rank = score >= 5 ? "master" : score >= 3 ? "detective" : "rookie";
  // Phone first: the take-home is the phone call, not the listening trick.
  const tipIcons = [IconPhone, IconEar, IconHandshake];

  return (
    <StationCard>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="rise font-mono text-xs tracking-[0.22em] text-ink-400 uppercase">
          {t("station6.title")}
        </p>
        <h2
          className="rise text-3xl font-black text-white sm:text-5xl md:text-6xl"
          style={{ animationDelay: "80ms" }}
        >
          {t(`station6.rank.${rank}`)}
        </h2>
        <p
          className="rise text-lg font-bold text-ink-400 tnum sm:text-xl"
          style={{ animationDelay: "160ms" }}
        >
          {t("station6.score", { score, total })}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4 py-2 sm:gap-5">
        <Badge icon={<IconBrain />} label={t("station6.badge1")} delayMs={240} />
        <Badge icon={<IconMagnifier />} label={t("station6.badge2")} delayMs={320} />
        <Badge icon={<IconSlider />} label={t("station6.badge3")} delayMs={400} />
        <Badge icon={<IconFactory />} label={t("station6.badge4")} delayMs={480} />
        {/* Earned by choosing to verify, not by hearing anything. */}
        {verifiedFirst && (
          <Badge icon={<IconPhone />} label={t("station6.badge5")} delayMs={560} />
        )}
      </div>

      {summary && summary.sessionsToday > 0 && (
        <p
          className="rise text-center text-sm font-semibold text-ink-400 tnum sm:text-base"
          style={{ animationDelay: "540ms" }}
        >
          {t("station6.crowd", {
            n: summary.sessionsToday,
            avg: summary.avgScore?.toFixed(1) ?? "–",
          })}
          {summary.hardestClip &&
            " " + t("station6.hardest", { pct: summary.hardestClip.fooledPct })}
          {summary.verifyFirstPct !== null &&
            " " + t("station6.verifyCrowd", { pct: summary.verifyFirstPct })}
        </p>
      )}

      <PersonaBubble who="echo" delayMs={600}>
        {t("station6.echoOutro")}
      </PersonaBubble>

      <div className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((i) => {
          const Icon = tipIcons[i - 1];
          return (
            <div
              key={i}
              className="rise min-w-0 rounded-[20px] bg-ink-800/70 p-4 ring-1 ring-white/[0.06] ring-inset sm:p-5"
              style={{ animationDelay: `${640 + i * 80}ms` }}
            >
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-[14px] bg-echo-500/15 text-echo-300">
                <Icon />
              </span>
              <p className="text-sm leading-snug font-bold text-white/85 sm:text-base">
                {t(`station6.tip${i}`)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex justify-center pt-1">
        <BigButton onClick={onRestart} tone="miko">
          {t("station6.restart")}
        </BigButton>
      </div>
    </StationCard>
  );
}
