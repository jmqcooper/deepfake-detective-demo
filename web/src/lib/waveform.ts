/**
 * Reading the actual sound, in the browser.
 *
 * Station 1's waveform and its "where was the loudest moment?" prediction are
 * both computed from the decoded audio the visitor is listening to. That is a
 * deliberate line: this demo may show a visitor what a *sound* did, and may
 * never show them what a model *thinks*, because there is no model running here
 * — the labels come from a prepared pack.
 */

export interface PeakVerdict {
  close: boolean;
  /** Absolute distance along the clip, 0..1. */
  distance: number;
}

/** Within an eighth of the clip counts as "you found it". */
export const PEAK_TOLERANCE = 0.12;

export function peakVerdict(guess: number, answer: number): PeakVerdict {
  const distance = Math.abs(guess - answer);
  return { close: distance <= PEAK_TOLERANCE, distance };
}

/** Index of the loudest bucket, as a 0..1 position along the clip. */
export function loudestFraction(peaks: number[]): number | null {
  if (!peaks.length) return null;
  let best = 0;
  for (let i = 1; i < peaks.length; i += 1) {
    if (peaks[i] > peaks[best]) best = i;
  }
  // Centre of the winning bucket, so the marker sits on the sound not before it.
  return (best + 0.5) / peaks.length;
}

/** Peak amplitude per bucket, normalised to 0..1. Pure — takes raw samples. */
export function bucketPeaks(samples: Float32Array | number[], buckets: number): number[] {
  const count = Math.max(1, buckets);
  const size = Math.max(1, Math.floor(samples.length / count));
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    let peak = 0;
    for (let j = 0; j < size; j += 1) {
      const value = Math.abs(samples[i * size + j] ?? 0);
      if (value > peak) peak = value;
    }
    out.push(peak);
  }
  const max = Math.max(...out, 1e-6);
  return out.map((p) => p / max);
}

/**
 * Max-pools a peak array down to `count` buckets — never up.
 *
 * Station 1 decodes once at a fixed resolution and re-buckets for the width it
 * actually has. Drawing a fixed 140 bars was what pushed the whole card off the
 * side of a 320px phone: the 3px gaps alone came to 417px.
 */
export function resamplePeaks(peaks: number[], count: number): number[] {
  if (count >= peaks.length || count < 1) return peaks;
  const size = peaks.length / count;
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j += 1) {
      if (peaks[j] > peak) peak = peaks[j];
    }
    return peak;
  });
}

/** How many bars fit a container, clamped to something that still reads. */
export function barCountFor(widthPx: number, pxPerBar = 6, min = 24, max = 140): number {
  const fits = Math.floor((widthPx || 320) / pxPerBar);
  return Math.max(min, Math.min(max, fits));
}

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

/**
 * Decodes a clip once and returns its peak envelope.
 *
 * The AudioContext is closed afterwards, always. It used to be created inline
 * and abandoned; every replay and every language switch leaked another one, and
 * browsers cap the number of live contexts per document — on a kiosk that runs
 * for a day, Station 1 eventually stops being able to draw its waveform at all.
 */
export async function decodePeaks(
  url: string,
  buckets = 512,
): Promise<number[] | null> {
  const Ctx =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext);
  if (!Ctx) return null;

  let context: AudioContext | null = null;
  try {
    const buffer = await fetch(url).then((response) => {
      if (!response.ok) throw new Error(`sample unavailable: ${response.status}`);
      return response.arrayBuffer();
    });
    context = new Ctx();
    const decoded = await context.decodeAudioData(buffer);
    return bucketPeaks(decoded.getChannelData(0), buckets);
  } catch {
    return null;
  } finally {
    if (context) {
      // `close()` returns a promise; a rejected one here is not worth surfacing.
      void context.close().catch(() => {});
    }
  }
}
