import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  manifestAssets,
  parseManifest,
  type Manifest,
} from "@/lib/manifest-schema";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function expectValid(value: unknown): Manifest {
  const result = parseManifest(value);
  if (!result.ok) {
    throw new Error(`expected a valid manifest, got: ${result.problems.join("; ")}`);
  }
  return result.manifest;
}

/** A minimal manifest in the shape `tools/prepare_samples.py` actually emits. */
function validManifest(): Record<string, unknown> {
  const rungs = [
    ["studio", null],
    ["phone", 24],
    ["whatsapp", 12],
    ["terrible", 6],
  ] as const;
  return {
    version: 1,
    generatedAt: "2026-07-14T01:59:58Z",
    source: "Common Voice (real) + Voxtral TTS (fake)",
    generation: {
      ttsModel: "mistralai/Voxtral-4B-TTS-2603",
      ttsRevision: "b81be46c3777f88621676791b512bb01dc1cb970",
      ttsLicense: "CC BY-NC 4.0",
      asrModel: "mistralai/Voxtral-Mini-4B-Realtime-2602",
      asrRevision: "2769294da9567371363522aac9bbcfdd19447add",
      asrLicense: "Apache-2.0",
      caseSources: [
        {
          lang: "nl",
          source: "Common Voice 17 (nl)",
          license: "CC0",
          revision: "8262c16bf297c87a9cd88c51997c4758ed7a8ba2",
        },
      ],
    },
    clips: [
      {
        id: "case-01",
        label: "real",
        lang: "nl",
        audio: "/samples/audio/case-01.mp3",
        durationSec: 4.0,
        difficulty: 1,
        transcript: "Een echte zin.",
        spectrogram: {
          image: "/samples/spec/case-01.png",
          bins: 64,
          frames: 251,
          maxFreqHz: 8000,
        },
        clue: null,
        provenance: { sourceId: "nl2-r01", attack: null, codec: null },
      },
    ],
    codecLadder: rungs.map(([id, bitrateKbps]) => ({
        id,
        labelKey: `codec.${id}`,
        audio: `/samples/codec/${id}.mp3`,
        spectrogram: `/samples/codec/${id}.png`,
        bitrateKbps,
        transcript: "Hallo.",
        audioEn: `/samples/codec/${id}_en.mp3`,
        spectrogramEn: `/samples/codec/${id}_en.png`,
        transcriptEn: "Hello.",
      })),
    fakeFactory: {
      available: true,
      model: "mistralai/Voxtral-4B-TTS-2603",
      sentences: [{ id: "s1", text: "Hoi!", scam: false }],
      voices: ["nl_female"],
      clips: [
        {
          id: "s1_nl_female",
          sentenceId: "s1",
          voice: "nl_female",
          lang: "nl",
          text: "Hoi!",
          scam: false,
          audio: "/samples/factory/s1_nl_female.mp3",
          spectrogram: "/samples/factory/s1_nl_female.png",
          transcript: "Hoi.",
        },
      ],
    },
  };
}

test("the schema accepts the shape the pipeline emits", () => {
  const result = parseManifest(validManifest());
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("the schema accepts the pack checked into this working tree, if present", async () => {
  let raw: string;
  try {
    raw = await readFile(join(webRoot, "public/samples/manifest.json"), "utf8");
  } catch {
    // The pack is generated and gitignored; skipping is the correct behaviour
    // on a fresh clone rather than failing a checkout that never ran the tools.
    return;
  }
  const result = parseManifest(JSON.parse(raw) as unknown);
  if (!result.ok) {
    throw new Error(`local pack rejected: ${result.problems.join("; ")}`);
  }
  assert.ok(result.manifest.clips.length > 0);
});

test("the tracked example stays aligned with the runtime contract", async () => {
  const raw = await readFile(
    join(webRoot, "public/samples/manifest.example.json"),
    "utf8",
  );
  expectValid(JSON.parse(raw) as unknown);
});

test("a malformed immutable revision is rejected", () => {
  const manifest = validManifest();
  const generation = manifest.generation as Record<string, unknown>;
  generation.ttsRevision = "main";
  assert.equal(parseManifest(manifest).ok, false);
});

test("the English codec mirrors are part of the contract", () => {
  const manifest = expectValid(validManifest());
  assert.equal(manifest.codecLadder[0].audioEn, "/samples/codec/studio_en.mp3");
  assert.equal(manifest.codecLadder[0].transcriptEn, "Hello.");
});

test("the factory carries concrete clips, not a filename pattern", () => {
  const factory = expectValid(validManifest()).fakeFactory;
  assert.equal(factory?.clips.length, 1);
  assert.equal(factory?.clips[0].transcript, "Hoi.");
  // The old schema demanded `langs` and `audioPattern`, which the pipeline has
  // never emitted — which is why every real pack was rejected.
  assert.equal("audioPattern" in (factory ?? {}), false);
});

test("a clip's spoken language is optional and defaults to Dutch by omission", () => {
  const manifest = validManifest();
  const clips = manifest.clips as Record<string, unknown>[];
  delete clips[0].lang;
  assert.equal(parseManifest(manifest).ok, true);
});

test("a malformed pack reports what is wrong instead of throwing", () => {
  const manifest = validManifest();
  (manifest.clips as Record<string, unknown>[])[0].label = "maybe";
  const result = parseManifest(manifest);
  if (result.ok) throw new Error("expected the manifest to be rejected");
  assert.ok(result.problems.length > 0);
  // The operator needs the field, not a stack trace.
  assert.ok(
    result.problems.some((problem) => problem.startsWith("clips.0.label")),
    result.problems.join("; "),
  );
});

test("an asset path outside /samples/ is refused", () => {
  for (const bad of [
    "https://example.test/evil.mp3",
    "/etc/passwd",
    "/samples/../../etc/passwd",
  ]) {
    const manifest = validManifest();
    (manifest.clips as Record<string, unknown>[])[0].audio = bad;
    assert.equal(parseManifest(manifest).ok, false, `accepted ${bad}`);
  }
});

test("a pack with no clips at all is not 'valid but empty'", () => {
  const manifest = validManifest();
  manifest.clips = [];
  assert.equal(parseManifest(manifest).ok, false);
});

test("a clue box is four fractions of the image", () => {
  const manifest = validManifest();
  (manifest.clips as Record<string, unknown>[])[0].clue = {
    key: "clue.tier1",
    box: [0.07, 0.25, 0.24, 0.65],
  };
  assert.equal(parseManifest(manifest).ok, true);

  (manifest.clips as Record<string, unknown>[])[0].clue = {
    key: "clue.tier1",
    box: [0.07, 0.25, 0.24, 1.4],
  };
  assert.equal(parseManifest(manifest).ok, false);
});

test("every referenced asset is listed once for the health check", () => {
  const assets = manifestAssets(expectValid(validManifest()));
  assert.equal(new Set(assets).size, assets.length);
  assert.ok(assets.includes("/samples/audio/case-01.mp3"));
  assert.ok(assets.includes("/samples/spec/case-01.png"));
  assert.ok(assets.includes("/samples/codec/studio_en.png"));
  assert.ok(assets.includes("/samples/factory/s1_nl_female.mp3"));
  assert.ok(assets.every((path) => path.startsWith("/samples/")));
});
