import test from "node:test";
import assert from "node:assert/strict";

import {
  ladderOutcome,
  normaliseTranscript,
  predictionWasRight,
  rungAudio,
  rungSpectrogram,
  rungTranscript,
} from "@/lib/codec-ladder";
import type { CodecRung } from "@/lib/manifest-schema";

function rung(id: string, transcript: string, transcriptEn?: string): CodecRung {
  return {
    id,
    labelKey: `codec.${id}`,
    audio: `/samples/codec/${id}.mp3`,
    spectrogram: `/samples/codec/${id}.png`,
    bitrateKbps: null,
    transcript,
    ...(transcriptEn === undefined
      ? {}
      : {
          transcriptEn,
          audioEn: `/samples/codec/${id}_en.mp3`,
          spectrogramEn: `/samples/codec/${id}_en.png`,
        }),
  };
}

test("punctuation and case are not what 'did it understand' means", () => {
  assert.equal(
    normaliseTranscript("Hallo, kom je vanmiddag naar het museum?"),
    normaliseTranscript("hallo kom je vanmiddag naar het museum"),
  );
  assert.equal(normaliseTranscript("   "), "");
});

test("words surviving the worst rung is read off the pack, not asserted", () => {
  const same = "Hallo, kom je vanmiddag naar het museum?";
  const outcome = ladderOutcome([rung("studio", same), rung("terrible", same)], "nl");
  assert.ok(outcome);
  assert.equal(outcome.producedWords, true);
  assert.equal(outcome.identical, true);
  assert.equal(outcome.actual, "understands");
});

test("a pack where the words degrade teaches that instead", () => {
  const outcome = ladderOutcome(
    [rung("studio", "Kom je vanmiddag naar het museum?"), rung("terrible", "Kom je middag.")],
    "nl",
  );
  assert.ok(outcome);
  assert.equal(outcome.producedWords, true);
  assert.equal(outcome.identical, false);
  assert.equal(outcome.actual, "understands");
});

test("an empty transcript at the worst rung is the strongest beat, and it is honest", () => {
  const outcome = ladderOutcome([rung("studio", "Hallo daar."), rung("terrible", "")], "nl");
  assert.ok(outcome);
  assert.equal(outcome.producedWords, false);
  assert.equal(outcome.actual, "fails");
});

test("the prediction is graded against what the pack actually did", () => {
  const outcome = ladderOutcome([rung("studio", "Hallo."), rung("terrible", "Hallo.")], "nl");
  assert.ok(outcome);
  assert.equal(predictionWasRight("understands", outcome), true);
  assert.equal(predictionWasRight("fails", outcome), false);
});

test("a ladder without transcripts yields no claim at all", () => {
  const bare = {
    id: "studio",
    labelKey: "codec.studio",
    audio: "/samples/codec/studio.mp3",
    spectrogram: "/samples/codec/studio.png",
    bitrateKbps: null,
  } as CodecRung;
  assert.equal(ladderOutcome([bare, bare], "nl"), null);
  assert.equal(ladderOutcome([], "nl"), null);
  assert.equal(ladderOutcome([rung("studio", "x")], "nl"), null);
});

test("English uses its own mirrors when the pack generated them", () => {
  const withEn = rung("studio", "Hallo.", "Hello.");
  assert.equal(rungAudio(withEn, "en"), "/samples/codec/studio_en.mp3");
  assert.equal(rungSpectrogram(withEn, "en"), "/samples/codec/studio_en.png");
  assert.equal(rungTranscript(withEn, "en"), "Hello.");
});

test("English falls back to the Dutch originals when there are no mirrors", () => {
  const dutchOnly = rung("studio", "Hallo.");
  assert.equal(rungAudio(dutchOnly, "en"), "/samples/codec/studio.mp3");
  assert.equal(rungSpectrogram(dutchOnly, "en"), "/samples/codec/studio.png");
  assert.equal(rungTranscript(dutchOnly, "en"), "Hallo.");
});

test("an empty English mirror is respected rather than treated as absent", () => {
  // `""` means the recogniser produced nothing at this rung — a real result,
  // and `?? fallback` would have silently replaced it with the Dutch words.
  const outcome = ladderOutcome(
    [rung("studio", "Hallo.", "Hello."), rung("terrible", "Hallo.", "")],
    "en",
  );
  assert.ok(outcome);
  assert.equal(outcome.actual, "fails");
});
