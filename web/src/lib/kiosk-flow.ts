/**
 * Every transition the kiosk can make, in one place.
 *
 * This used to be spread across DemoShell and the stations, each with its own
 * idea of what "done" meant: Station 2 fired `station_complete`, the other four
 * fired nothing, skipping fired nothing at all, and the 45-second final-station
 * reset in SPEC.md was never implemented — every screen used the same 90 s.
 * So the numbers a curator would read off the demo were quietly wrong.
 *
 * The flow is a pure function of (state, action) so it can be tested without a
 * DOM, and so "did this station report its completion?" is a property of the
 * table rather than of five separate components remembering to call `track`.
 */

export const STATION_COUNT = 6;

/** SPEC.md § Kiosk behaviour. */
export const IDLE_MS = 90_000;
export const IDLE_MS_STATION_5 = 45_000;

export type StationIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type Phase = "attract" | "soundCheck" | "briefing" | "station";

export interface FlowState {
  phase: Phase;
  station: StationIndex;
}

export type FlowAction =
  | { type: "start" }
  | { type: "soundCheckDone" }
  | { type: "beginStation" }
  | { type: "advance" }
  | { type: "skip" }
  | { type: "restart" };

/** Stations that open with a mission briefing. Station 6 is the outro. */
const BRIEFED: ReadonlySet<StationIndex> = new Set<StationIndex>([0, 1, 2, 3, 4]);

export function initialFlow(): FlowState {
  return { phase: "attract", station: 0 };
}

export function hasBriefing(station: StationIndex): boolean {
  return BRIEFED.has(station);
}

function enter(station: StationIndex): FlowState {
  return { phase: hasBriefing(station) ? "briefing" : "station", station };
}

function nextStation(station: StationIndex): StationIndex {
  return Math.min(station + 1, STATION_COUNT - 1) as StationIndex;
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "start":
      // The sound check comes before the first briefing: everything after it is
      // audio, and a muted tablet turns the whole demo into a slideshow.
      return { phase: "soundCheck", station: 0 };
    case "soundCheckDone":
      return enter(0);
    case "beginStation":
      return { phase: "station", station: state.station };
    case "advance":
    case "skip":
      if (state.phase === "attract") return state;
      if (state.phase === "soundCheck") return enter(0);
      if (state.station >= STATION_COUNT - 1) return state;
      return enter(nextStation(state.station));
    case "restart":
      return initialFlow();
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled flow action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The idle timer. Station 6 is the diploma. A finished visitor stands there
 * reading it, so it resets sooner to free the kiosk for the next one. The
 * attract screen is already the reset state and must not loop a timer.
 */
export function idleTimeoutMs(state: FlowState): number {
  if (state.phase === "attract") return 0;
  if (state.station === STATION_COUNT - 1 && state.phase === "station") {
    return IDLE_MS_STATION_5;
  }
  return IDLE_MS;
}

/** Human-readable station number (1..6) for telemetry and copy. */
export function stationNumber(station: StationIndex): number {
  return station + 1;
}

export type TransitionReason = "advance" | "skip";

export interface FlowTelemetry {
  type: "station_complete" | "station_skip";
  station: number;
}

/**
 * What leaving `from` should report. Every station is represented, and a skip
 * is its own event rather than a silent gap in the funnel — an exhibit where
 * 40% of visitors skip Station 3 is a finding, not noise.
 */
export function transitionTelemetry(
  from: FlowState,
  reason: TransitionReason,
): FlowTelemetry | null {
  if (from.phase === "attract" || from.phase === "soundCheck") return null;
  if (from.phase === "briefing" && reason === "advance") return null;
  return {
    type: reason === "skip" ? "station_skip" : "station_complete",
    station: stationNumber(from.station),
  };
}
