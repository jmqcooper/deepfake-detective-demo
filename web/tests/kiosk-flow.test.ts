import test from "node:test";
import assert from "node:assert/strict";

import {
  flowReducer,
  hasBriefing,
  idleTimeoutMs,
  initialFlow,
  stationNumber,
  transitionTelemetry,
  IDLE_MS,
  IDLE_MS_STATION_5,
  STATION_COUNT,
  type FlowState,
  type StationIndex,
} from "@/lib/kiosk-flow";

const station = (n: StationIndex): FlowState => ({ phase: "station", station: n });

test("a visit starts on the attract screen with no idle timer", () => {
  const start = initialFlow();
  assert.deepEqual(start, { phase: "attract", station: 0 });
  assert.equal(idleTimeoutMs(start), 0);
});

test("the sound check comes before the first briefing", () => {
  const afterStart = flowReducer(initialFlow(), { type: "start" });
  assert.equal(afterStart.phase, "soundCheck");
  const afterCheck = flowReducer(afterStart, { type: "soundCheckDone" });
  assert.deepEqual(afterCheck, { phase: "briefing", station: 0 });
});

test("stations 1-5 open on a briefing, station 6 does not", () => {
  assert.equal(hasBriefing(0), true);
  assert.equal(hasBriefing(3), true);
  assert.equal(hasBriefing(4), true);
  assert.equal(hasBriefing(5), false);
  assert.deepEqual(flowReducer(station(4), { type: "advance" }), {
    phase: "station",
    station: 5,
  });
  assert.deepEqual(flowReducer(station(3), { type: "advance" }), {
    phase: "briefing",
    station: 4,
  });
});

test("advancing walks the whole demo and stops at the last station", () => {
  let state = flowReducer(
    flowReducer(initialFlow(), { type: "start" }),
    { type: "soundCheckDone" },
  );
  const visited: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    if (state.phase === "briefing") state = flowReducer(state, { type: "beginStation" });
    if (state.phase === "station") visited.push(state.station);
    state = flowReducer(state, { type: "advance" });
  }
  assert.deepEqual([...new Set(visited)], [0, 1, 2, 3, 4, 5]);
  assert.equal(state.station, STATION_COUNT - 1);
});

test("SPEC.md idle rule: 45 s on station 6, 90 s everywhere else", () => {
  assert.equal(idleTimeoutMs(station(5)), IDLE_MS_STATION_5);
  assert.equal(IDLE_MS_STATION_5, 45_000);
  for (const n of [0, 1, 2, 3, 4] as StationIndex[]) {
    assert.equal(idleTimeoutMs(station(n)), IDLE_MS);
  }
  assert.equal(IDLE_MS, 90_000);
  // The station-6 briefing does not exist, but its diploma must reset sooner
  // than the sound check does.
  assert.equal(idleTimeoutMs({ phase: "soundCheck", station: 0 }), IDLE_MS);
});

test("every station reports its own completion, not just station 2", () => {
  for (const n of [0, 1, 2, 3, 4, 5] as StationIndex[]) {
    assert.deepEqual(transitionTelemetry(station(n), "advance"), {
      type: "station_complete",
      station: stationNumber(n),
    });
  }
});

test("skipping is its own event rather than a silent gap", () => {
  assert.deepEqual(transitionTelemetry(station(2), "skip"), {
    type: "station_skip",
    station: 3,
  });
  assert.deepEqual(transitionTelemetry({ phase: "briefing", station: 2 }, "skip"), {
    type: "station_skip",
    station: 3,
  });
});

test("leaving a briefing normally is not a completion", () => {
  assert.equal(transitionTelemetry({ phase: "briefing", station: 1 }, "advance"), null);
  assert.equal(transitionTelemetry(initialFlow(), "advance"), null);
  assert.equal(
    transitionTelemetry({ phase: "soundCheck", station: 0 }, "advance"),
    null,
  );
});

test("restart returns to the attract screen from anywhere", () => {
  assert.deepEqual(flowReducer(station(5), { type: "restart" }), initialFlow());
});

test("skipping from the sound check lands on station 1, not past it", () => {
  assert.deepEqual(flowReducer({ phase: "soundCheck", station: 0 }, { type: "skip" }), {
    phase: "briefing",
    station: 0,
  });
});
