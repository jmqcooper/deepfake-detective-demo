/**
 * Client-side view of `public/samples/manifest.json` (see SPEC.md).
 * The stations fetch the manifest directly in the browser so that stations 2-5
 * work as pure static assets — no server round-trip, no GPU, deployable anywhere.
 */

export type ClipLabel = "real" | "fake";

export interface ClueBox {
  /** i18n key for the detective's explanation of the tell. */
  key: string;
  /** [x, y, w, h] as 0..1 fractions of the spectrogram image. */
  box: [number, number, number, number];
}

export interface SpectrogramRef {
  image: string;
  bins: number;
  frames: number;
  maxFreqHz: number;
}

export interface Clip {
  id: string;
  label: ClipLabel;
  /** Spoken language of the clip; absent means Dutch (older packs). */
  lang?: string;
  audio: string;
  durationSec: number;
  difficulty: number;
  spectrogram: SpectrogramRef;
  clue: ClueBox | null;
  /** Only present on the Station 1 walkthrough clip: what Miko hears. */
  transcript?: string;
  provenance?: {
    sourceId?: string;
    attack?: string | null;
    codec?: string | null;
  };
}

export interface CodecRung {
  id: string;
  labelKey: string;
  audio: string;
  spectrogram: string;
  bitrateKbps: number | null;
  /** What the ASR heard at THIS quality — it degrades as you compress. */
  transcript?: string;
  /** English mirror of the same rung (TTS-scripted), when generated. */
  audioEn?: string;
  spectrogramEn?: string;
  transcriptEn?: string;
}

/** A deepfake of a sentence we wrote, plus what the ASR actually heard. */
export interface FactoryClip {
  id: string;
  sentenceId: string;
  voice: string;
  text: string;
  scam: boolean;
  audio: string;
  spectrogram: string;
  transcript: string;
  /** Spoken language of this clip; absent means Dutch (the original pack). */
  lang?: string;
}

export interface FakeFactory {
  available: boolean;
  model?: string;
  sentences: { id: string; text: string; scam: boolean }[];
  voices: string[];
  clips: FactoryClip[];
}

export interface Manifest {
  version: number;
  generatedAt: string;
  source: string;
  clips: Clip[];
  codecLadder: CodecRung[];
  fakeFactory?: FakeFactory;
}

export function resolveFactoryAudio(
  pattern: string,
  sentence: string,
  voice: string,
  lang: string,
): string {
  return pattern
    .replace("{sentence}", sentence)
    .replace("{voice}", voice)
    .replace("{lang}", lang);
}
