import test from "node:test";
import assert from "node:assert/strict";

import { encodePcm16Wav, joinSamples } from "@/lib/wav";

test("joins captured audio chunks in order", () => {
  assert.deepEqual(
    Array.from(joinSamples([new Float32Array([0, 0.5]), new Float32Array([-0.5])])),
    [0, 0.5, -0.5],
  );
});

test("encodes a mono PCM16 WAV with a bounded sample range", async () => {
  const blob = encodePcm16Wav(new Float32Array([-2, 0, 2]), 16_000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
});
