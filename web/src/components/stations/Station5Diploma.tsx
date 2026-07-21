"use client";

import { useEffect, useState } from "react";
import { useT, type Lang } from "@/components/kiosk/hooks";
import { Badge, BigButton, PersonaBubble, StationCard } from "@/components/kiosk/ui";
import {
  IconBrain,
  IconEar,
  IconFactory,
  IconHandshake,
  IconMagnifier,
  IconPhone,
  IconSlider,
} from "@/components/kiosk/icons";

interface Summary {
  sessionsToday: number;
  avgScore: number | null;
  hardestClip: { clipId: string; fooledPct: number } | null;
}

/**
 * Station 5 — the diploma.
 *
 * The most important element on this screen is not the score, it's the crowd
 * stat: "62% of visitors fell for that one too". For a general audience the
 * reassurance that being fooled is normal is the whole take-home — a visitor who
 * leaves feeling stupid has learned nothing useful.
 */
export function Station5Diploma({
  score,
  total,
  lang,
  onRestart,
}: {
  score: number;
  total: number;
  lang: Lang;
  onRestart: () => void;
}) {
  const t = useT(lang);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/stats/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Summary | null) => setSummary(s))
      .catch(() => setSummary(null));
  }, []);

  const rank = score >= 5 ? "master" : score >= 3 ? "detective" : "rookie";
  const tipIcons = [IconEar, IconPhone, IconHandshake];

  return (
    <StationCard>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="rise font-mono text-xs tracking-[0.22em] text-ink-400 uppercase">
          {t("station5.title")}
        </p>
        <h2
          className="rise text-5xl font-black text-white md:text-6xl"
          style={{ animationDelay: "80ms" }}
        >
          {t(`station5.rank.${rank}`)}
        </h2>
        <p
          className="rise text-xl font-bold text-ink-400 tnum"
          style={{ animationDelay: "160ms" }}
        >
          {t("station5.score", { score, total })}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-5 py-2">
        <Badge icon={<IconBrain />} label={t("station5.badge1")} delayMs={240} />
        <Badge icon={<IconMagnifier />} label={t("station5.badge2")} delayMs={320} />
        <Badge icon={<IconSlider />} label={t("station5.badge3")} delayMs={400} />
        <Badge icon={<IconFactory />} label={t("station5.badge4")} delayMs={480} />
      </div>

      {summary && summary.sessionsToday > 0 && (
        <p
          className="rise text-center text-base font-semibold text-ink-400 tnum"
          style={{ animationDelay: "540ms" }}
        >
          {t("station5.crowd", {
            n: summary.sessionsToday,
            avg: summary.avgScore?.toFixed(1) ?? "–",
          })}
          {summary.hardestClip &&
            " " + t("station5.hardest", { pct: summary.hardestClip.fooledPct })}
        </p>
      )}

      <PersonaBubble who="echo" delayMs={600}>
        {t("station5.echoOutro")}
      </PersonaBubble>

      <div className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((i) => {
          const Icon = tipIcons[i - 1];
          return (
            <div
              key={i}
              className="rise rounded-[20px] bg-ink-800/70 p-5 ring-1 ring-white/[0.06] ring-inset"
              style={{ animationDelay: `${640 + i * 80}ms` }}
            >
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-[14px] bg-echo-500/15 text-echo-300">
                <Icon />
              </span>
              <p className="text-base leading-snug font-bold text-white/85">
                {t(`station5.tip${i}`)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex justify-center pt-1">
        <BigButton onClick={onRestart} tone="miko">
          {t("station5.restart")}
        </BigButton>
      </div>
    </StationCard>
  );
}
