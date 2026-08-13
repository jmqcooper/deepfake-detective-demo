import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionLedger,
  MAX_GUESSES_PER_SESSION,
  SESSION_TTL_MS,
} from "@/lib/session-ledger";

const SESSION = "1b4e28ba-2fa1-4d3b-a3f5-ccbf1a2c1b31";
const OTHER = "2b4e28ba-2fa1-4d3b-a3f5-ccbf1a2c1b32";

test("correctness is derived from the manifest label, not asserted", () => {
  const ledger = new SessionLedger();
  assert.equal(ledger.recordGuess(SESSION, "case-02", "fake", "fake", 0).correct, true);
  assert.equal(ledger.recordGuess(SESSION, "case-01", "fake", "real", 0).correct, false);
});

test("a repeat guess on the same clip is answered but not counted", () => {
  const ledger = new SessionLedger();
  const first = ledger.recordGuess(SESSION, "case-02", "fake", "fake", 0);
  assert.equal(first.accepted, true);

  // Second guess flips the answer; the ledger keeps the original verdict and
  // the score does not move — otherwise one visitor could push a clip's
  // "fooled" percentage anywhere they liked.
  const second = ledger.recordGuess(SESSION, "case-02", "real", "fake", 0);
  assert.equal(second.accepted, false);
  assert.equal(second.correct, true);
  assert.deepEqual(second.score, { answered: 1, correct: 1 });
});

test("the session score is the tally of accepted guesses", () => {
  const ledger = new SessionLedger();
  ledger.recordGuess(SESSION, "case-01", "real", "real", 0);
  ledger.recordGuess(SESSION, "case-02", "real", "fake", 0);
  ledger.recordGuess(SESSION, "case-03", "fake", "fake", 0);
  assert.deepEqual(ledger.scoreFor(SESSION, 0), { answered: 3, correct: 2 });
});

test("sessions do not see each other's guesses", () => {
  const ledger = new SessionLedger();
  ledger.recordGuess(SESSION, "case-01", "real", "real", 0);
  assert.deepEqual(ledger.scoreFor(OTHER, 0), { answered: 0, correct: 0 });
});

test("a guess flood is capped per session", () => {
  const ledger = new SessionLedger();
  for (let i = 0; i < MAX_GUESSES_PER_SESSION + 20; i += 1) {
    ledger.recordGuess(SESSION, `case-${i}`, "real", "real", 0);
  }
  assert.equal(ledger.scoreFor(SESSION, 0).answered, MAX_GUESSES_PER_SESSION);
});

test("only the newest sessions are kept", () => {
  const ledger = new SessionLedger(3, SESSION_TTL_MS);
  for (let i = 0; i < 10; i += 1) {
    ledger.recordGuess(`session-${i}`, "case-01", "real", "real", i);
  }
  assert.equal(ledger.size, 3);
  assert.deepEqual(ledger.scoreFor("session-0", 10), { answered: 0, correct: 0 });
  assert.deepEqual(ledger.scoreFor("session-9", 10), { answered: 1, correct: 1 });
});

test("a session is forgotten once its lifetime elapses", () => {
  const ledger = new SessionLedger(100, 1_000);
  ledger.recordGuess(SESSION, "case-01", "real", "real", 0);
  assert.deepEqual(ledger.scoreFor(SESSION, 500), { answered: 1, correct: 1 });
  assert.deepEqual(ledger.scoreFor(SESSION, 5_000), { answered: 0, correct: 0 });
});

test("expired sessions are evicted, not merely hidden", () => {
  const ledger = new SessionLedger(100, 1_000);
  ledger.recordGuess(SESSION, "case-01", "real", "real", 0);
  ledger.recordGuess(OTHER, "case-01", "real", "real", 10_000);
  assert.equal(ledger.size, 1);
});

test("a reset forgets the id entirely", () => {
  const ledger = new SessionLedger();
  ledger.recordGuess(SESSION, "case-01", "real", "real", 0);
  ledger.forget(SESSION);
  assert.equal(ledger.size, 0);
  assert.deepEqual(ledger.scoreFor(SESSION, 0), { answered: 0, correct: 0 });
});

test("the final scenario is recorded once", () => {
  const ledger = new SessionLedger();
  assert.deepEqual(ledger.recordFinalScenario(SESSION, true, 0), {
    accepted: true,
    correct: true,
  });
  assert.deepEqual(ledger.recordFinalScenario(SESSION, false, 0), {
    accepted: false,
    correct: true,
  });
});
