import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

const fractionSchema = z.number().min(0).max(1);

export const manifestSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    source: z.string().min(1),
    clips: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.enum(["real", "fake"]),
          audio: z.string().min(1),
          durationSec: z.number().min(3).max(8),
          difficulty: z.number().int().min(1).max(5),
          spectrogram: z
            .object({
              image: z.string().min(1),
              bins: z.number().int().positive(),
              frames: z.number().int().positive(),
              maxFreqHz: z.number().int().positive(),
            })
            .strict(),
          clue: z
            .object({
              key: z.string().min(1),
              box: z.tuple([fractionSchema, fractionSchema, fractionSchema, fractionSchema]),
            })
            .strict()
            .nullable(),
          provenance: z
            .object({
              sourceId: z.string().min(1),
              attack: z.string().nullable(),
              codec: z.string().nullable(),
            })
            .strict(),
          transcript: z.string(),
        })
        .strict(),
    ),
    codecLadder: z.array(
      z
        .object({
          id: z.string().min(1),
          labelKey: z.string().min(1),
          audio: z.string().min(1),
          spectrogram: z.string().min(1),
          bitrateKbps: z.number().int().positive().nullable(),
          transcript: z.string(),
        })
        .strict(),
    ),
    fakeFactory: z
      .object({
        available: z.boolean(),
        sentences: z.array(
          z
            .object({
              id: z.string().min(1),
              textKey: z.string().min(1),
              scam: z.boolean(),
            })
            .strict(),
        ),
        voices: z.array(
          z
            .object({
              id: z.string().min(1),
              nameKey: z.string().min(1),
              avatar: z.string().min(1),
            })
            .strict(),
        ),
        langs: z.array(z.enum(["nl", "en"])),
        audioPattern: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;

let cachedManifest: Promise<Manifest | null> | undefined;
let didLogManifestError = false;

async function readManifest(): Promise<Manifest | null> {
  try {
    const path = join(process.cwd(), "public", "samples", "manifest.json");
    const contents = await readFile(path, "utf8");
    const parsed = manifestSchema.safeParse(JSON.parse(contents) as unknown);
    if (!parsed.success) {
      if (!didLogManifestError) {
        didLogManifestError = true;
        console.warn("Sample manifest is invalid; treating it as unavailable.", parsed.error);
      }
      return null;
    }
    return parsed.data;
  } catch (error: unknown) {
    if (!didLogManifestError) {
      didLogManifestError = true;
      console.warn("Sample manifest is unavailable; run the sample pipeline first.", error);
    }
    return null;
  }
}

export function loadManifest(): Promise<Manifest | null> {
  cachedManifest ??= readManifest();
  return cachedManifest;
}
