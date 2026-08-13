/**
 * THE manifest contract — one schema, one set of types, used by both the
 * browser and the server (see SPEC.md § "Data contract").
 *
 * This file deliberately imports nothing from `node:*` so the browser can run
 * the same validation the API does. Before this existed there were two
 * descriptions of the pack: a hand-written set of interfaces the stations used,
 * and a server-side Zod schema that had drifted so far from what the pipeline
 * actually emits that it rejected every real pack. A malformed manifest is a
 * routine field problem — it has to produce a friendly screen, not a mystery.
 */

import { z } from "zod";

/** 0..1 fraction of the spectrogram image. */
const fraction = z.number().min(0).max(1);

export const LANGS = ["nl", "en"] as const;
export const langSchema = z.enum(LANGS);

/**
 * Every asset path in the pack is a site-absolute URL under /samples/.
 * Anchoring it here means a hand-edited manifest cannot point the kiosk at an
 * arbitrary origin, and the health check can map a path to a file on disk.
 */
const assetPath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\/samples\/[A-Za-z0-9._/-]+$/, "must be a /samples/… path")
  .refine((value) => !value.includes(".."), "must not traverse directories");

export const clueSchema = z
  .object({
    /** i18n key for the detective's explanation of the tell. */
    key: z.string().min(1).max(120),
    /** [x, y, w, h] as 0..1 fractions of the spectrogram image. */
    box: z.tuple([fraction, fraction, fraction, fraction]),
  })
  .strict();

export const spectrogramRefSchema = z
  .object({
    image: assetPath,
    bins: z.number().int().positive(),
    frames: z.number().int().positive(),
    maxFreqHz: z.number().int().positive(),
  })
  .strict();

export const clipSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.enum(["real", "fake"]),
    /** Spoken language of the clip; absent means Dutch (older packs). */
    lang: langSchema.optional(),
    audio: assetPath,
    durationSec: z.number().positive().max(60),
    difficulty: z.number().int().min(1).max(5),
    /** The ASR's real output for this clip, mistakes included. */
    transcript: z.string().min(1).max(2000),
    spectrogram: spectrogramRefSchema,
    clue: clueSchema.nullable(),
    provenance: z
      .object({
        sourceId: z.string().min(1).max(128),
        attack: z.string().max(200).nullable(),
        codec: z.string().max(200).nullable(),
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const codecRungSchema = z
  .object({
    id: z.string().min(1).max(64),
    labelKey: z.string().min(1).max(120),
    audio: assetPath,
    spectrogram: assetPath,
    bitrateKbps: z.number().int().positive().nullable(),
    /** What the ASR heard at THIS quality — it degrades as you compress. */
    transcript: z.string().min(1).max(2000),
    /** English mirrors of the same rung, wherever the pack generated them. */
    audioEn: assetPath.optional(),
    spectrogramEn: assetPath.optional(),
    transcriptEn: z.string().min(1).max(2000).optional(),
  })
  .strict();

/** A deepfake of a sentence we wrote, plus what the ASR actually heard. */
export const factoryClipSchema = z
  .object({
    id: z.string().min(1).max(128),
    sentenceId: z.string().min(1).max(64),
    voice: z.string().min(1).max(64),
    /** Spoken language of this clip; absent means Dutch (the original pack). */
    lang: langSchema.optional(),
    /** The sentence we asked for. */
    text: z.string().min(1).max(500),
    scam: z.boolean(),
    audio: assetPath,
    spectrogram: assetPath,
    /** The sentence the ASR came back with. Compare the two — that is the point. */
    transcript: z.string().min(1).max(2000),
  })
  .strict();

export const fakeFactorySchema = z
  .object({
    available: z.boolean(),
    model: z.string().max(200).optional(),
    sentences: z.array(
      z
        .object({
          id: z.string().min(1).max(64),
          text: z.string().min(1).max(500),
          scam: z.boolean(),
        })
        .strict(),
    ),
    voices: z.array(z.string().min(1).max(64)),
    clips: z.array(factoryClipSchema),
  })
  .strict();

export const manifestSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().min(1).max(64),
    source: z.string().min(1).max(500),
    generation: z
      .object({
        ttsModel: z.string().min(1).max(200),
        ttsRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
        ttsLicense: z.string().min(1).max(100),
        asrModel: z.string().min(1).max(200),
        asrRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
        asrLicense: z.string().min(1).max(100),
        caseSources: z
          .array(
            z
              .object({
                lang: langSchema,
                source: z.string().min(1).max(300),
                license: z.string().min(1).max(100),
                revision: z.string().regex(/^[a-f0-9]{40}$/).optional(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .optional(),
    clips: z.array(clipSchema).min(1),
    codecLadder: z.array(codecRungSchema).length(4),
    fakeFactory: fakeFactorySchema,
  })
  .strict();

export type ClipLabel = z.infer<typeof clipSchema>["label"];
export type Lang = z.infer<typeof langSchema>;
export type ClueBox = z.infer<typeof clueSchema>;
export type SpectrogramRef = z.infer<typeof spectrogramRefSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type CodecRung = z.infer<typeof codecRungSchema>;
export type FactoryClip = z.infer<typeof factoryClipSchema>;
export type FakeFactory = z.infer<typeof fakeFactorySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

export type ManifestParse =
  | { ok: true; manifest: Manifest }
  | { ok: false; reason: "malformed"; problems: string[] };

/** Up to this many field errors are surfaced; a broken pack fails in bulk. */
const MAX_REPORTED_PROBLEMS = 8;

/**
 * Parses an already-JSON-decoded value. Returns the problems as short strings
 * so a kiosk operator (or the health endpoint) sees *what* is wrong with the
 * pack without a stack trace or an absolute path.
 */
export function parseManifest(value: unknown): ManifestParse {
  const parsed = manifestSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, manifest: parsed.data };
  }
  const problems = parsed.error.issues
    .slice(0, MAX_REPORTED_PROBLEMS)
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
  return { ok: false, reason: "malformed", problems };
}

/** Every asset the pack references, de-duplicated — used by /api/health. */
export function manifestAssets(manifest: Manifest): string[] {
  const assets = new Set<string>();
  for (const clip of manifest.clips) {
    assets.add(clip.audio);
    assets.add(clip.spectrogram.image);
  }
  for (const rung of manifest.codecLadder) {
    assets.add(rung.audio);
    assets.add(rung.spectrogram);
    if (rung.audioEn) assets.add(rung.audioEn);
    if (rung.spectrogramEn) assets.add(rung.spectrogramEn);
  }
  for (const clip of manifest.fakeFactory?.clips ?? []) {
    assets.add(clip.audio);
    assets.add(clip.spectrogram);
  }
  return [...assets];
}
