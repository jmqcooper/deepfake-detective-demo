/**
 * Station 3's honest payoff.
 *
 * The station asks the visitor to predict one thing before they hear anything:
 * at the crackliest setting, will the speech recogniser still manage to write
 * the sentence down? The answer is not written by us — it is read off the
 * transcripts the pipeline captured from the real ASR at each rung. If a future
 * pack degrades differently, the station teaches whatever that pack actually
 * shows.
 */

import type { CodecRung } from "@/lib/manifest-schema";

export type LadderPrediction = "understands" | "fails";

export interface LadderOutcome {
  studioTranscript: string;
  worstTranscript: string;
  /** The recogniser still produced words at the worst rung. */
  producedWords: boolean;
  /** Those words are the same sentence it produced at studio quality. */
  identical: boolean;
  actual: LadderPrediction;
}

/** Case, punctuation and spacing are not what "did it understand" means. */
export function normaliseTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rungAudio(rung: CodecRung, lang: string): string {
  return lang === "en" && rung.audioEn ? rung.audioEn : rung.audio;
}

export function rungSpectrogram(rung: CodecRung, lang: string): string {
  return lang === "en" && rung.spectrogramEn ? rung.spectrogramEn : rung.spectrogram;
}

export function rungTranscript(rung: CodecRung, lang: string): string | undefined {
  return lang === "en" && rung.transcriptEn !== undefined
    ? rung.transcriptEn
    : rung.transcript;
}

export function ladderOutcome(
  ladder: CodecRung[],
  lang: string,
): LadderOutcome | null {
  if (ladder.length < 2) return null;
  const studio = rungTranscript(ladder[0], lang);
  const worst = rungTranscript(ladder[ladder.length - 1], lang);
  if (studio === undefined || worst === undefined) return null;

  const normalisedStudio = normaliseTranscript(studio);
  const normalisedWorst = normaliseTranscript(worst);
  const producedWords = normalisedWorst.length > 0;

  return {
    studioTranscript: studio,
    worstTranscript: worst,
    producedWords,
    identical: producedWords && normalisedWorst === normalisedStudio,
    actual: producedWords ? "understands" : "fails",
  };
}

export function predictionWasRight(
  prediction: LadderPrediction,
  outcome: LadderOutcome,
): boolean {
  return prediction === outcome.actual;
}
