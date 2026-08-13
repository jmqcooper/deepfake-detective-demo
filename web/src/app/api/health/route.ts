import { access } from "node:fs/promises";

import { assetFilePath, assetPathsOf, loadManifestState } from "@/lib/manifest";
import { isStatsDriverAvailable, statsDriverName } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/health` — for whoever has to get the kiosk running before the doors
 * open. It answers the three questions that actually go wrong on the morning of
 * an exhibition: is the app up, is there a usable sample pack behind it, and
 * are the stats being recorded.
 *
 * Deliberately says nothing about internals: no file-system paths, no stack
 * traces, no environment. A malformed pack reports *which fields* are wrong,
 * because that is the operator's next action; everything else is a boolean.
 */

/** Spot-check rather than stat every asset: a pack is ~120 files. */
const MEDIA_SAMPLE_SIZE = 12;

type CheckStatus = "ok" | "degraded" | "failed";

function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

export async function GET(): Promise<Response> {
  const manifestState = await loadManifestState();

  const manifest =
    manifestState.status === "ready"
      ? {
          status: "ok" as CheckStatus,
          present: true,
          valid: true,
          clips: manifestState.manifest.clips.length,
          codecRungs: manifestState.manifest.codecLadder.length,
          factoryClips: manifestState.manifest.fakeFactory?.clips.length ?? 0,
          languages: [
            ...new Set(manifestState.manifest.clips.map((clip) => clip.lang ?? "nl")),
          ].sort(),
        }
      : {
          status: "failed" as CheckStatus,
          present: manifestState.status === "malformed",
          valid: false,
          clips: 0,
          codecRungs: 0,
          factoryClips: 0,
          languages: [] as string[],
          problems: manifestState.status === "malformed" ? manifestState.problems : undefined,
        };

  let media: {
    status: CheckStatus;
    checked: number;
    missing: number;
    examples: string[];
  } = { status: "failed", checked: 0, missing: 0, examples: [] };

  if (manifestState.status === "ready") {
    const sample = pickEvenly(assetPathsOf(manifestState.manifest), MEDIA_SAMPLE_SIZE);
    const missing: string[] = [];
    await Promise.all(
      sample.map(async (assetPath) => {
        const file = assetFilePath(assetPath);
        if (!file) {
          missing.push(assetPath);
          return;
        }
        try {
          await access(file);
        } catch {
          missing.push(assetPath);
        }
      }),
    );
    media = {
      status: missing.length === 0 ? "ok" : "failed",
      checked: sample.length,
      missing: missing.length,
      // The manifest-relative URL, which is what an operator needs to regenerate.
      examples: missing.slice(0, 3).sort(),
    };
  }

  const statsAvailable = isStatsDriverAvailable();
  const stats = {
    // Stats being down degrades the exhibit's reporting, never its teaching.
    status: (statsAvailable ? "ok" : "degraded") as CheckStatus,
    driver: statsDriverName(),
    available: statsAvailable,
  };

  const checks = { app: { status: "ok" as CheckStatus }, manifest, media, stats };
  const failed = Object.values(checks).some((check) => check.status === "failed");
  const degraded = Object.values(checks).some((check) => check.status === "degraded");

  return Response.json(
    {
      status: failed ? "failed" : degraded ? "degraded" : "ok",
      checks,
    },
    {
      // 503 only when the kiosk genuinely cannot run its demo.
      status: failed ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
