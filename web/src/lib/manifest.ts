import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

import {
  manifestAssets,
  parseManifest,
  type Clip,
  type ClipLabel,
  type Manifest,
} from "@/lib/manifest-schema";

export type { Manifest } from "@/lib/manifest-schema";
export { manifestSchema, parseManifest } from "@/lib/manifest-schema";

export type ManifestState =
  | { status: "ready"; manifest: Manifest }
  | { status: "missing" }
  | { status: "malformed"; problems: string[] };

const SAMPLES_ROOT = () => join(process.cwd(), "public", "samples");

let cached: Promise<ManifestState> | undefined;
let didLog = false;

function logOnce(message: string, detail?: unknown): void {
  if (didLog) return;
  didLog = true;
  console.warn(message, detail);
}

async function readManifest(): Promise<ManifestState> {
  let contents: string;
  try {
    contents = await readFile(join(SAMPLES_ROOT(), "manifest.json"), "utf8");
  } catch (error: unknown) {
    logOnce("Sample manifest is unavailable; run the sample pipeline first.", error);
    return { status: "missing" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(contents);
  } catch (error: unknown) {
    logOnce("Sample manifest is not valid JSON; treating the pack as unusable.", error);
    return { status: "malformed", problems: ["(root): not valid JSON"] };
  }

  const parsed = parseManifest(decoded);
  if (!parsed.ok) {
    logOnce("Sample manifest does not match the contract in SPEC.md.", parsed.problems);
    return { status: "malformed", problems: parsed.problems };
  }
  return { status: "ready", manifest: parsed.manifest };
}

/** Cached for the life of the process — the pack is generated offline. */
export function loadManifestState(): Promise<ManifestState> {
  cached ??= readManifest();
  return cached;
}

export async function loadManifest(): Promise<Manifest | null> {
  const state = await loadManifestState();
  return state.status === "ready" ? state.manifest : null;
}

/** Test seam: forget the cached read (also used after a pack is regenerated). */
export function resetManifestCache(): void {
  cached = undefined;
  didLog = false;
}

export async function findClip(clipId: string): Promise<Clip | null> {
  const manifest = await loadManifest();
  if (!manifest) return null;
  return manifest.clips.find((clip) => clip.id === clipId) ?? null;
}

/**
 * The server's answer to "is this clip real or fake?". The client never gets to
 * assert it — that is the whole point of resolving the label here.
 */
export async function clipLabel(clipId: string): Promise<ClipLabel | null> {
  const clip = await findClip(clipId);
  return clip?.label ?? null;
}

/** Maps a manifest asset path to its file on disk, refusing to escape /samples. */
export function assetFilePath(assetPath: string): string | null {
  if (!assetPath.startsWith("/samples/")) return null;
  const root = SAMPLES_ROOT();
  const resolved = normalize(join(root, assetPath.slice("/samples/".length)));
  return resolved === root || resolved.startsWith(root + sep) ? resolved : null;
}

export function assetPathsOf(manifest: Manifest): string[] {
  return manifestAssets(manifest);
}
