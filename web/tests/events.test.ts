import test from "node:test";
import assert from "node:assert/strict";

import {
  handleEvent,
  readBoundedJson,
  MAX_BODY_BYTES,
  type EventDeps,
  type EventError,
  type EventResponse,
  type EventResult,
} from "@/lib/events";
import { SessionLedger } from "@/lib/session-ledger";
import type { ClipLabel } from "@/lib/manifest-schema";
import type { ClipStats, DemoEvent } from "@/lib/stats";

const SESSION = "1b4e28ba-2fa1-4d3b-a3f5-ccbf1a2c1b31";

const LABELS: Record<string, ClipLabel> = {
  "case-01": "real",
  "case-02": "fake",
  "case-03": "fake",
};

interface Harness {
  deps: EventDeps;
  recorded: DemoEvent[];
}

function harness(overrides: Partial<EventDeps> = {}): Harness {
  const recorded: DemoEvent[] = [];
  return {
    recorded,
    deps: {
      resolveClipLabel: async (clipId: string) => LABELS[clipId] ?? null,
      record: (event: DemoEvent) => {
        recorded.push(event);
      },
      clipStats: (clipId: string): ClipStats => ({
        clipId,
        guesses: 42,
        fooledPct: 71,
      }),
      statsAvailable: () => true,
      ledger: new SessionLedger(),
      now: () => 0,
      ...overrides,
    },
  };
}

/** Narrows to the success branch, failing loudly with the body if it is not. */
function expectOk(result: EventResult, status: 200 | 202 = 200): EventResponse {
  if (result.status !== 200 && result.status !== 202) {
    throw new Error(
      `expected success, got ${result.status}: ${JSON.stringify(result.body)}`,
    );
  }
  assert.equal(result.status, status);
  return result.body;
}

function expectRejected(result: EventResult, status: 400 | 404 | 413): EventError {
  if (result.status === 200 || result.status === 202) {
    throw new Error(`expected ${status}, got a success: ${JSON.stringify(result.body)}`);
  }
  assert.equal(result.status, status);
  return result.body;
}

function guessEvent(clipId: string, choice: ClipLabel): Record<string, unknown> {
  return {
    sessionId: SESSION,
    station: 2,
    lang: "nl",
    type: "guess",
    clipId,
    guess: choice,
  };
}

/* ------------------------------------------------------------- validation */

test("a body that is not an object is rejected", async () => {
  expectRejected(await handleEvent("nope", harness().deps), 400);
});

test("a session id that is not a uuid v4 is rejected", async () => {
  // What the old Math.random fallback produced — every one of these was
  // silently thrown away by the API.
  const result = await handleEvent(
    { ...guessEvent("case-01", "real"), sessionId: "8342342341234" },
    harness().deps,
  );
  expectRejected(result, 400);
});

test("unknown fields are refused rather than stored", async () => {
  const result = await handleEvent(
    { ...guessEvent("case-01", "real"), evil: 1 },
    harness().deps,
  );
  expectRejected(result, 400);
});

test("a station outside 1..5 is rejected", async () => {
  for (const station of [0, 6, 99, -1]) {
    const result = await handleEvent(
      { ...guessEvent("case-01", "real"), station },
      harness().deps,
    );
    expectRejected(result, 400);
  }
});

test("an over-long clip id is rejected before it reaches the manifest", async () => {
  let lookups = 0;
  const { deps } = harness({
    resolveClipLabel: async () => {
      lookups += 1;
      return null;
    },
  });
  expectRejected(await handleEvent(guessEvent("x".repeat(500), "real"), deps), 400);
  assert.equal(lookups, 0);
});

test("a clip the pack does not contain is refused, not counted", async () => {
  const { deps, recorded } = harness();
  const body = expectRejected(await handleEvent(guessEvent("case-99", "real"), deps), 404);
  assert.deepEqual(body, { error: "unknown_clip", clipId: "case-99" });
  assert.equal(recorded.length, 0);
});

/* ---------------------------------------------- server-authoritative logic */

test("the client cannot declare its own correctness", async () => {
  const { deps, recorded } = harness();

  // `correct` is not in the contract any more, so a client asserting it is
  // simply refused rather than believed.
  const cheating = await handleEvent(
    { ...guessEvent("case-01", "fake"), correct: true },
    deps,
  );
  expectRejected(cheating, 400);
  assert.equal(recorded.length, 0);

  const honest = expectOk(await handleEvent(guessEvent("case-01", "fake"), deps));
  assert.equal(honest.guess?.correct, false);
  assert.equal(honest.guess?.label, "real");
});

test("the response carries the clip aggregate, so the reveal cannot race it", async () => {
  const body = expectOk(
    await handleEvent(guessEvent("case-02", "fake"), harness().deps),
  );
  assert.deepEqual(body.clipStats, { clipId: "case-02", guesses: 42, fooledPct: 71 });
});

test("a repeat guess is answered but does not double-count", async () => {
  const { deps, recorded } = harness();
  expectOk(await handleEvent(guessEvent("case-02", "fake"), deps));
  const again = expectOk(await handleEvent(guessEvent("case-02", "real"), deps));
  assert.equal(again.accepted, false);
  assert.equal(again.guess?.correct, true);
  assert.equal(recorded.filter((e) => e.type === "guess").length, 1);
});

test("the session score is derived from accepted guesses", async () => {
  const { deps, recorded } = harness();
  expectOk(await handleEvent(guessEvent("case-01", "real"), deps)); // right
  expectOk(await handleEvent(guessEvent("case-02", "real"), deps)); // wrong
  expectOk(await handleEvent(guessEvent("case-03", "fake"), deps)); // right

  const completion = expectOk(
    await handleEvent(
      { sessionId: SESSION, station: 5, lang: "nl", type: "session_complete" },
      deps,
    ),
  );
  assert.deepEqual(completion.session, { answered: 3, correct: 2 });

  const stored = recorded.find((e) => e.type === "session_complete");
  assert.ok(stored && stored.type === "session_complete");
  assert.equal(stored.score, 2);
});

test("session_complete does not accept a score from the client", async () => {
  const result = await handleEvent(
    { sessionId: SESSION, station: 5, lang: "nl", type: "session_complete", score: 5 },
    harness().deps,
  );
  expectRejected(result, 400);
});

test("the final scenario is scored on the server", async () => {
  const right = harness();
  const rightBody = expectOk(
    await handleEvent(
      {
        sessionId: SESSION,
        station: 5,
        lang: "nl",
        type: "final_scenario",
        choice: "callback",
      },
      right.deps,
    ),
  );
  assert.equal(rightBody.scenario?.correct, true);

  const stored = right.recorded.find((e) => e.type === "final_scenario");
  assert.ok(stored && stored.type === "final_scenario");
  assert.equal(stored.correct, true);
  assert.equal(stored.choice, "callback");

  // Replying in the same channel feels like checking and verifies nothing.
  const wrongBody = expectOk(
    await handleEvent(
      {
        sessionId: SESSION,
        station: 5,
        lang: "nl",
        type: "final_scenario",
        choice: "reply",
      },
      harness().deps,
    ),
  );
  assert.equal(wrongBody.scenario?.correct, false);
});

test("an invented scenario answer is rejected", async () => {
  const result = await handleEvent(
    {
      sessionId: SESSION,
      station: 5,
      lang: "nl",
      type: "final_scenario",
      choice: "whatever",
    },
    harness().deps,
  );
  expectRejected(result, 400);
});

test("a reset forgets the session on the server too", async () => {
  const { deps } = harness();
  expectOk(await handleEvent(guessEvent("case-01", "real"), deps));
  expectOk(
    await handleEvent(
      { sessionId: SESSION, station: 1, lang: "nl", type: "session_reset" },
      deps,
    ),
  );
  const after = expectOk(
    await handleEvent(
      { sessionId: SESSION, station: 1, lang: "nl", type: "station_enter" },
      deps,
    ),
  );
  assert.deepEqual(after.session, { answered: 0, correct: 0 });
});

test("skips and completions are accepted for every station", async () => {
  const { deps, recorded } = harness();
  for (const station of [1, 2, 3, 4, 5]) {
    expectOk(
      await handleEvent(
        { sessionId: SESSION, station, lang: "nl", type: "station_skip" },
        deps,
      ),
    );
    expectOk(
      await handleEvent(
        { sessionId: SESSION, station, lang: "nl", type: "station_complete" },
        deps,
      ),
    );
  }
  assert.equal(recorded.filter((e) => e.type === "station_skip").length, 5);
  assert.equal(recorded.filter((e) => e.type === "station_complete").length, 5);
});

/* ------------------------------------------------------------ degradation */

test("no stats store still answers with the derived verdict, at 202", async () => {
  const { deps } = harness({ statsAvailable: () => false });
  const body = expectOk(await handleEvent(guessEvent("case-02", "fake"), deps), 202);
  assert.equal(body.guess?.correct, true);
  assert.equal(body.persisted, false);
  // The crowd stat is withheld rather than invented as a row of zeroes.
  assert.equal(body.clipStats, null);
});

/* ------------------------------------------------------------ body limits */

function jsonRequest(body: string, contentLength?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("https://example.test/api/events", {
    method: "POST",
    headers,
    body,
  });
}

async function expectBodyError(request: Request): Promise<string> {
  const result = await readBoundedJson(request);
  if (result.ok) throw new Error("expected the body to be refused");
  return result.error.error;
}

test("a declared oversize body is refused", async () => {
  assert.equal(
    await expectBodyError(jsonRequest("{}", String(MAX_BODY_BYTES + 1))),
    "body_too_large",
  );
});

test("a body that lies about its length is still refused", async () => {
  const huge = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES * 2) });
  assert.equal(await expectBodyError(jsonRequest(huge, "10")), "body_too_large");
});

test("the limit counts bytes, not characters", async () => {
  // Each of these is one JS character and three UTF-8 bytes.
  const multibyte = JSON.stringify({ pad: "☃".repeat(MAX_BODY_BYTES) });
  assert.ok(multibyte.length > MAX_BODY_BYTES);
  assert.equal(await expectBodyError(jsonRequest(multibyte)), "body_too_large");
});

test("malformed JSON is refused, not thrown", async () => {
  assert.equal(await expectBodyError(jsonRequest("{not json")), "invalid_json");
});

test("an ordinary event passes the size check", async () => {
  const body = JSON.stringify(guessEvent("case-02", "fake"));
  const result = await readBoundedJson(jsonRequest(body, String(body.length)));
  assert.equal(result.ok, true);
});
