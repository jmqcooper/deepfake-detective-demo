/**
 * Station 2's round builder, extracted so the property that matters can
 * actually be checked.
 *
 * Two things must hold at once:
 *
 * 1. The answers must be unguessable. The manifest lists the pool strictly
 *    real/fake/real/fake, so playing it in order lets a sharp nine-year-old
 *    crack the pattern by round three and stop listening.
 * 2. Every run must contain BOTH real and fake clips. Drawing each tier
 *    independently at random can deal five reals in a row — the visitor answers
 *    "echt" five times, scores 5/5, and learns nothing.
 *
 * So the NUMBER of fakes is fixed (2 or 3 of 5) and WHICH tiers they land in is
 * random. The mix is guaranteed; the order stays unpredictable.
 */

import type { Clip, ClipLabel } from "@/lib/manifest-schema";

export const MIN_FAKES = 2;
export const MAX_FAKES = 3;

export type Rng = () => number;

function pick<T>(items: T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildRounds(clips: Clip[], rng: Rng = Math.random): Clip[] {
  const tiers = [...new Set(clips.map((clip) => clip.difficulty))].sort((a, b) => a - b);
  if (tiers.length === 0) return [];

  const fakeCount = Math.min(
    tiers.length,
    MIN_FAKES + Math.floor(rng() * (MAX_FAKES - MIN_FAKES + 1)),
  );
  const fakeTiers = new Set(shuffle(tiers, rng).slice(0, fakeCount));

  return tiers.flatMap((tier) => {
    const want: ClipLabel = fakeTiers.has(tier) ? "fake" : "real";
    const preferred = clips.filter(
      (clip) => clip.difficulty === tier && clip.label === want,
    );
    const pool = preferred.length
      ? preferred
      : clips.filter((clip) => clip.difficulty === tier);
    return pool.length ? [pick(pool, rng)] : [];
  });
}

/** Both labels present — the property a five-real run would violate. */
export function isBalanced(rounds: Clip[]): boolean {
  return (
    rounds.some((clip) => clip.label === "real") &&
    rounds.some((clip) => clip.label === "fake")
  );
}

/**
 * The case pool for a language. Station 1's walkthrough clips are excluded —
 * they are a scripted demonstration, not a case to judge.
 */
export function casePool(clips: Clip[], lang: string): Clip[] {
  const cases = clips.filter((clip) => !clip.id.startsWith("station1"));
  const inLang = cases.filter((clip) => (clip.lang ?? "nl") === lang);
  return inLang.length >= 10 ? inLang : cases.filter((clip) => (clip.lang ?? "nl") === "nl");
}

export function walkthroughClip(clips: Clip[], lang: string): Clip | undefined {
  const localised = lang === "en" ? clips.find((clip) => clip.id === "station1-en") : undefined;
  return localised ?? clips.find((clip) => clip.id === "station1") ?? casePool(clips, lang)[0];
}
