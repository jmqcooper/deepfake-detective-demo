import test from "node:test";
import assert from "node:assert/strict";

import { buildRounds, casePool, isBalanced, walkthroughClip } from "@/lib/quiz";
import type { Clip, ClipLabel } from "@/lib/manifest-schema";

function clip(
  id: string,
  label: ClipLabel,
  difficulty: number,
  lang = "nl",
): Clip {
  return {
    id,
    label,
    lang: lang as "nl" | "en",
    audio: `/samples/audio/${id}.mp3`,
    durationSec: 4,
    difficulty,
    transcript: "test transcript",
    spectrogram: {
      image: `/samples/spec/${id}.png`,
      bins: 64,
      frames: 251,
      maxFreqHz: 8000,
    },
    clue: label === "fake" ? { key: `clue.tier${difficulty}`, box: [0, 0, 1, 1] } : null,
  };
}

/** The real pack's shape: five tiers, one real and one fake in each. */
function pack(lang = "nl"): Clip[] {
  return [1, 2, 3, 4, 5].flatMap((tier) => [
    clip(`${lang}-r${tier}`, "real", tier, lang),
    clip(`${lang}-f${tier}`, "fake", tier, lang),
  ]);
}

/** Deterministic pseudo-random so a failure is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("a run always draws one clip per difficulty tier, in order", () => {
  const rounds = buildRounds(pack(), seeded(1));
  assert.equal(rounds.length, 5);
  assert.deepEqual(
    rounds.map((c) => c.difficulty),
    [1, 2, 3, 4, 5],
  );
});

test("every possible run contains both real and fake clips", () => {
  // The failure this guards against is not hypothetical: drawing each tier
  // independently once dealt five real clips in a row, so a visitor answered
  // "echt" five times, scored 5/5 and learned nothing.
  for (let seed = 0; seed < 500; seed += 1) {
    const rounds = buildRounds(pack(), seeded(seed));
    assert.equal(isBalanced(rounds), true, `seed ${seed}: ${rounds.map((c) => c.label)}`);
  }
});

test("a run has two or three fakes, never all or none", () => {
  for (let seed = 0; seed < 500; seed += 1) {
    const fakes = buildRounds(pack(), seeded(seed)).filter((c) => c.label === "fake");
    assert.ok(fakes.length >= 2 && fakes.length <= 3, `seed ${seed}: ${fakes.length}`);
  }
});

test("the order is not the manifest's real/fake alternation", () => {
  const patterns = new Set<string>();
  for (let seed = 0; seed < 200; seed += 1) {
    patterns.add(buildRounds(pack(), seeded(seed)).map((c) => c.label[0]).join(""));
  }
  // A predictable station is a station a nine-year-old stops listening to.
  assert.ok(patterns.size > 3, `only ${patterns.size} distinct orders`);
});

test("a tier missing the wanted label falls back rather than dropping the round", () => {
  const lopsided = [
    clip("r1", "real", 1),
    clip("f1", "fake", 1),
    clip("r2", "real", 2), // no fake at tier 2 at all
    clip("r3", "real", 3),
    clip("f3", "fake", 3),
  ];
  for (let seed = 0; seed < 100; seed += 1) {
    assert.equal(buildRounds(lopsided, seeded(seed)).length, 3);
  }
});

test("an empty pool yields no rounds instead of throwing", () => {
  assert.deepEqual(buildRounds([], seeded(1)), []);
});

test("the case pool excludes the Station 1 walkthrough clips", () => {
  const clips = [
    clip("station1", "fake", 1),
    clip("station1-en", "fake", 1, "en"),
    ...pack(),
  ];
  const pool = casePool(clips, "nl");
  assert.equal(pool.some((c) => c.id.startsWith("station1")), false);
  assert.equal(pool.length, 10);
});

test("a language with a full pack of its own is used; otherwise Dutch", () => {
  const both = [...pack("nl"), ...pack("en")];
  assert.equal(casePool(both, "en").every((c) => c.lang === "en"), true);

  // A pack with only a couple of English clips falls back rather than running
  // a three-round mission in the wrong language.
  const thin = [...pack("nl"), clip("en-r1", "real", 1, "en")];
  assert.equal(casePool(thin, "en").every((c) => c.lang === "nl"), true);
});

test("the walkthrough clip follows the interface language when the pack has it", () => {
  const clips = [clip("station1", "fake", 1), clip("station1-en", "fake", 1, "en"), ...pack()];
  assert.equal(walkthroughClip(clips, "nl")?.id, "station1");
  assert.equal(walkthroughClip(clips, "en")?.id, "station1-en");

  // No English walkthrough in the pack: the Dutch one, not nothing.
  const dutchOnly = [clip("station1", "fake", 1), ...pack()];
  assert.equal(walkthroughClip(dutchOnly, "en")?.id, "station1");
});
