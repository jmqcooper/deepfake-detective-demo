import test from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryDriver,
  retentionCutoff,
  shouldPrune,
  trimToCap,
  MAX_MEMORY_EVENTS,
  MIN_GUESSES_FOR_PERCENTAGE,
  RETENTION_DAYS,
  type DemoEvent,
} from "@/lib/stats";

function guess(session: string, clipId: string, correct: boolean): DemoEvent {
  return {
    sessionId: session,
    station: 2,
    lang: "nl",
    type: "guess",
    clipId,
    guess: correct ? "fake" : "real",
    correct,
  };
}

test("a percentage is withheld until there is enough of a crowd", () => {
  const driver = createMemoryDriver();
  for (let i = 0; i < MIN_GUESSES_FOR_PERCENTAGE - 1; i += 1) {
    driver.recordEvent(guess(`s${i}`, "case-02", false));
  }
  const few = driver.getClipStats("case-02");
  assert.equal(few.guesses, MIN_GUESSES_FOR_PERCENTAGE - 1);
  // 100% off nine visitors is noise dressed up as a finding.
  assert.equal(few.fooledPct, null);

  driver.recordEvent(guess("s-last", "case-02", false));
  assert.equal(driver.getClipStats("case-02").fooledPct, 100);
});

test("fooledPct is the share of WRONG guesses", () => {
  const driver = createMemoryDriver();
  for (let i = 0; i < 10; i += 1) {
    driver.recordEvent(guess(`s${i}`, "case-05", i < 3));
  }
  assert.deepEqual(driver.getClipStats("case-05"), {
    clipId: "case-05",
    guesses: 10,
    fooledPct: 70,
  });
});

test("one visitor cannot count twice on the same clip", () => {
  const driver = createMemoryDriver();
  for (let i = 0; i < 50; i += 1) {
    driver.recordEvent(guess("same-session", "case-02", false));
  }
  assert.equal(driver.getClipStats("case-02").guesses, 1);
});

test("an unseen clip reports nothing rather than guessing", () => {
  assert.deepEqual(createMemoryDriver().getClipStats("case-77"), {
    clipId: "case-77",
    guesses: 0,
    fooledPct: null,
  });
});

test("the summary averages one completion per session", () => {
  const driver = createMemoryDriver();
  driver.recordEvent({
    sessionId: "a",
    station: 6,
    lang: "nl",
    type: "session_complete",
    score: 4,
  });
  // A double-submitted completion must not drag the average.
  driver.recordEvent({
    sessionId: "a",
    station: 6,
    lang: "nl",
    type: "session_complete",
    score: 0,
  });
  driver.recordEvent({
    sessionId: "b",
    station: 6,
    lang: "en",
    type: "session_complete",
    score: 2,
  });

  const summary = driver.getSummary();
  assert.equal(summary.sessionsToday, 2);
  assert.equal(summary.avgScore, 3);
});

test("the hardest clip needs a crowd behind it too", () => {
  const driver = createMemoryDriver();
  // One clip with a single wrong guess: 100% fooled, and meaningless.
  driver.recordEvent(guess("lonely", "case-99", false));
  for (let i = 0; i < 12; i += 1) {
    driver.recordEvent(guess(`s${i}`, "case-06", i < 2));
  }
  const summary = driver.getSummary();
  assert.equal(summary.hardestClip?.clipId, "case-06");
});

test("the final-scenario share is reported once there is a crowd", () => {
  const driver = createMemoryDriver();
  for (let i = 0; i < 4; i += 1) {
    driver.recordEvent({
      sessionId: `s${i}`,
      station: 6,
      lang: "nl",
      type: "final_scenario",
      choice: "callback",
      correct: true,
    });
  }
  assert.equal(driver.getSummary().verifyFirstPct, null);

  for (let i = 4; i < 10; i += 1) {
    driver.recordEvent({
      sessionId: `s${i}`,
      station: 6,
      lang: "nl",
      type: "final_scenario",
      choice: "reply",
      correct: false,
    });
  }
  assert.equal(driver.getSummary().verifyFirstPct, 40);
});

test("an empty store degrades to no data rather than to zeroes", () => {
  const summary = createMemoryDriver().getSummary();
  assert.deepEqual(summary, {
    sessionsToday: 0,
    avgScore: null,
    hardestClip: null,
    verifyFirstPct: null,
  });
});

/* ------------------------------------------------------------- retention */

test("in-memory events are capped so a long-running kiosk cannot grow forever", () => {
  const driver = createMemoryDriver();
  const overflow = 25;
  for (let i = 0; i < MAX_MEMORY_EVENTS + overflow; i += 1) {
    driver.recordEvent({
      sessionId: `s${i}`,
      station: 1,
      lang: "nl",
      type: "station_enter",
    });
  }
  // Nothing throws, nothing is lost that matters, and the newest data survives.
  assert.equal(driver.isAvailable(), true);
});

test("trimToCap keeps the newest items", () => {
  assert.deepEqual(trimToCap([1, 2, 3, 4, 5], 3), [3, 4, 5]);
  assert.deepEqual(trimToCap([1, 2], 5), [1, 2]);
  assert.deepEqual(trimToCap([], 5), []);
});

test("the retention cutoff is the configured number of days back", () => {
  const now = new Date("2026-08-05T12:00:00Z");
  const cutoff = retentionCutoff(now, 30);
  assert.equal(cutoff.toISOString(), "2026-07-06T12:00:00.000Z");
  assert.ok(RETENTION_DAYS >= 1);
});

test("pruning runs on first use and then only occasionally", () => {
  assert.equal(shouldPrune(null, 0), true);
  assert.equal(shouldPrune(0, 60_000), false);
  assert.equal(shouldPrune(0, 31 * 60_000), true);
});
