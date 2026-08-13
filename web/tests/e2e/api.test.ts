import test, { before, describe } from "node:test";
import assert from "node:assert/strict";

import { uuidV4 } from "@/lib/uuid";

/**
 * End-to-end against a running kiosk.
 *
 * Start the app (`npm run build && npm run start`, or `npm run dev`) and then
 * `npm run e2e`. Point it elsewhere with E2E_BASE_URL. It is a separate script
 * from `npm test` on purpose: the unit suite must stay runnable with nothing
 * else alive, and this one needs a server and a generated sample pack.
 *
 * These are the paths that only break in the wiring: route handlers, the real
 * manifest on disk, the real stats driver, and the status codes an operator's
 * monitoring will key on.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3_000) });
    return true;
  } catch {
    return false;
  }
}

function post(body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("kiosk API", async () => {
  let up = false;
  before(async () => {
    up = await reachable();
    if (!up) {
      console.warn(
        `[e2e] no server at ${BASE_URL} — start the app first, or set E2E_BASE_URL.`,
      );
    }
  });

  test("health reports the app, the pack and the stats store", async (t) => {
    if (!up) return t.skip("no server");
    const response = await fetch(`${BASE_URL}/api/health`);
    assert.ok([200, 503].includes(response.status));

    const body = (await response.json()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    assert.ok(["ok", "degraded", "failed"].includes(body.status));
    assert.deepEqual(Object.keys(body.checks).sort(), [
      "app",
      "manifest",
      "media",
      "stats",
    ]);

    // Operator-facing means operator-facing: no paths, no stack traces.
    const raw = JSON.stringify(body);
    assert.equal(raw.includes("/Users/"), false);
    assert.equal(raw.includes("node_modules"), false);
    assert.equal(/at\s+\w+\s+\(/.test(raw), false);
  });

  test("a guess is scored by the server and answered with the aggregate", async (t) => {
    if (!up) return t.skip("no server");
    const manifest = await fetch(`${BASE_URL}/samples/manifest.json`);
    if (!manifest.ok) return t.skip("no sample pack generated");

    const pack = (await manifest.json()) as {
      clips: { id: string; label: "real" | "fake" }[];
    };
    const clip = pack.clips.find((c) => !c.id.startsWith("station1"));
    assert.ok(clip, "the pack has no case clips");

    const wrong = clip.label === "real" ? "fake" : "real";
    const response = await post({
      sessionId: uuidV4(),
      station: 2,
      lang: "nl",
      type: "guess",
      clipId: clip.id,
      guess: wrong,
    });
    assert.ok([200, 202].includes(response.status));

    const body = (await response.json()) as {
      guess: { correct: boolean; label: string } | null;
      session: { answered: number; correct: number };
    };
    assert.equal(body.guess?.correct, false);
    assert.equal(body.guess?.label, clip.label);
    assert.deepEqual(body.session, { answered: 1, correct: 0 });
  });

  test("a clip the pack does not contain is refused", async (t) => {
    if (!up) return t.skip("no server");
    const response = await post({
      sessionId: uuidV4(),
      station: 2,
      lang: "nl",
      type: "guess",
      clipId: "case-does-not-exist",
      guess: "real",
    });
    assert.equal(response.status, 404);
    assert.equal(await fetch(`${BASE_URL}/api/stats/clip/case-does-not-exist`).then((r) => r.status), 404);
  });

  test("a client cannot post its own verdict", async (t) => {
    if (!up) return t.skip("no server");
    const response = await post({
      sessionId: uuidV4(),
      station: 2,
      lang: "nl",
      type: "guess",
      clipId: "case-01",
      guess: "real",
      correct: true,
    });
    assert.equal(response.status, 400);
  });

  test("an oversized body is refused rather than buffered", async (t) => {
    if (!up) return t.skip("no server");
    const response = await post({
      sessionId: uuidV4(),
      station: 2,
      lang: "nl",
      type: "station_enter",
      padding: "x".repeat(100_000),
    });
    assert.ok([400, 413].includes(response.status));
  });

  test("the summary is shaped for Station 5 even with no data", async (t) => {
    if (!up) return t.skip("no server");
    const body = (await fetch(`${BASE_URL}/api/stats/summary`).then((r) => r.json())) as {
      sessionsToday: number;
      avgScore: number | null;
      hardestClip: unknown;
      verifyFirstPct: number | null;
    };
    assert.equal(typeof body.sessionsToday, "number");
    assert.ok(body.avgScore === null || typeof body.avgScore === "number");
    assert.ok(body.hardestClip === null || typeof body.hardestClip === "object");
    assert.ok(body.verifyFirstPct === null || typeof body.verifyFirstPct === "number");
  });

  test("a runaway session is throttled instead of filling the database", async (t) => {
    if (!up) return t.skip("no server");
    const sessionId = uuidV4();
    let throttled = false;
    for (let i = 0; i < 90 && !throttled; i += 1) {
      const response = await post({
        sessionId,
        station: 1,
        lang: "nl",
        type: "station_enter",
      });
      if (response.status === 429) {
        assert.ok(response.headers.get("retry-after"));
        throttled = true;
      }
    }
    assert.equal(throttled, true, "90 events in a row were all accepted");
  });
});
