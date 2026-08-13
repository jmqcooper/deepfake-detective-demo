import test from "node:test";
import assert from "node:assert/strict";

import {
  barCountFor,
  bucketPeaks,
  loudestFraction,
  peakVerdict,
  resamplePeaks,
  PEAK_TOLERANCE,
} from "@/lib/waveform";

test("peaks are normalised to 0..1 with the loudest bucket at 1", () => {
  const samples = [0.1, 0.1, 0.5, 0.5, 0.2, 0.2];
  const peaks = bucketPeaks(samples, 3);
  assert.equal(peaks.length, 3);
  assert.equal(Math.max(...peaks), 1);
  assert.ok(peaks.every((p) => p >= 0 && p <= 1));
});

test("silence does not divide by zero", () => {
  const peaks = bucketPeaks(new Float32Array(64), 8);
  assert.equal(peaks.length, 8);
  assert.ok(peaks.every((p) => Number.isFinite(p)));
});

test("the loudest moment is the centre of the loudest bucket", () => {
  assert.equal(loudestFraction([0, 0, 1, 0]), 0.625);
  assert.equal(loudestFraction([1]), 0.5);
  assert.equal(loudestFraction([]), null);
});

test("a prediction within an eighth of the clip counts as found", () => {
  assert.equal(peakVerdict(0.5, 0.5).close, true);
  assert.equal(peakVerdict(0.5, 0.5 + PEAK_TOLERANCE / 2).close, true);
  assert.equal(peakVerdict(0.5, 0.5 + PEAK_TOLERANCE * 2).close, false);
  assert.ok(Math.abs(peakVerdict(0.9, 0.1).distance - 0.8) < 1e-9);
});

test("the waveform is re-bucketed to fit, never clipped", () => {
  const peaks = Array.from({ length: 512 }, (_, i) => (i === 500 ? 1 : 0.1));
  const small = resamplePeaks(peaks, 24);
  assert.equal(small.length, 24);
  // Max-pooling, so the one loud moment survives being shown at phone width.
  assert.equal(Math.max(...small), 1);
});

test("re-bucketing never invents detail it does not have", () => {
  const peaks = [0.2, 0.4, 0.6];
  assert.deepEqual(resamplePeaks(peaks, 10), peaks);
  assert.deepEqual(resamplePeaks(peaks, 0), peaks);
});

test("the bar count fits the container instead of overflowing it", () => {
  // The bug this replaces: a fixed 140 bars with 3px gaps came to 417px of
  // gaps alone, on a viewport 320px wide.
  const narrow = barCountFor(264); // a 320px phone, minus the card's padding
  assert.ok(narrow * 6 <= 264 + 6, `${narrow} bars will not fit 264px`);
  assert.ok(narrow >= 24, "too few bars to read as a waveform");

  const wide = barCountFor(1200);
  assert.ok(wide <= 140);
  assert.ok(wide > narrow);
});

test("an unmeasured container still renders something sensible", () => {
  const bars = barCountFor(0);
  assert.ok(bars >= 24 && bars <= 140);
});
