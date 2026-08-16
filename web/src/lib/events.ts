/**
 * `POST /api/events`, minus the HTTP.
 *
 * Three things changed here and they are all the same change: the browser used
 * to tell the server whether a guess was right and what the final score was.
 * A museum kiosk is not a hostile environment, but a public URL is, and an
 * endpoint that accepts `{"correct": true}` five hundred times has no numbers
 * worth reporting. So:
 *
 *  - the clip's label is resolved from the validated manifest;
 *  - correctness is derived from (guess, label);
 *  - the session score is derived from the guesses the server accepted;
 *  - an unknown clip id is refused rather than counted.
 *
 * The response carries the derived result *and* the clip's aggregate, because
 * the reveal needs both at the same instant. Station 2 used to POST the guess
 * and immediately GET the clip stats, which is a read-after-write race against
 * its own write: the "71% were fooled" line could show a number that did not
 * include the visitor standing in front of it.
 */

import { z } from "zod";

import type { ClipLabel } from "@/lib/manifest-schema";
import { clipLabel as manifestClipLabel } from "@/lib/manifest";
import { isFinalScenarioCorrect, FINAL_SCENARIO_CHOICES } from "@/lib/final-scenario";
import { sessionLedger, type SessionLedger, type SessionScore } from "@/lib/session-ledger";
import {
  getClipStats,
  isStatsDriverAvailable,
  recordEvent,
  type ClipStats,
  type DemoEvent,
} from "@/lib/stats";
import { UUID_V4_PATTERN } from "@/lib/uuid";

/** A full event is a few hundred bytes; 2 KiB is generous and finite. */
export const MAX_BODY_BYTES = 2_048;

const commonFields = {
  sessionId: z.string().regex(UUID_V4_PATTERN, "must be a uuid v4"),
  station: z.number().int().min(1).max(6),
  lang: z.enum(["nl", "en"]),
};

/**
 * Written out one branch at a time on purpose. `.strict()` on every one is what
 * refuses a `correct` or `score` field outright rather than ignoring it, so a
 * client that still sends its own verdict gets a 400 instead of silence.
 */
export const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...commonFields, type: z.literal("station_enter") }).strict(),
  z.object({ ...commonFields, type: z.literal("station_complete") }).strict(),
  z.object({ ...commonFields, type: z.literal("station_skip") }).strict(),
  z.object({ ...commonFields, type: z.literal("session_reset") }).strict(),
  z.object({ ...commonFields, type: z.literal("session_complete") }).strict(),
  z
    .object({
      ...commonFields,
      type: z.literal("guess"),
      clipId: z.string().min(1).max(128),
      guess: z.enum(["real", "fake"]),
    })
    .strict(),
  z
    .object({
      ...commonFields,
      type: z.literal("final_scenario"),
      choice: z.enum(FINAL_SCENARIO_CHOICES),
    })
    .strict(),
]);

export type EventInput = z.infer<typeof eventSchema>;

/** At most this many field errors come back; a broken client fails in bulk. */
const MAX_REPORTED_ISSUES = 10;

interface ValidationIssue {
  path: PropertyKey[];
  message: string;
}

/**
 * Field errors, built by hand rather than via `flattenError`, so the response
 * shape is a plain `Record<string, string[]>` and is bounded.
 */
function fieldErrors(issues: readonly ValidationIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues.slice(0, MAX_REPORTED_ISSUES)) {
    const key = issue.path.map(String).join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export interface EventResponse {
  /** Whether this event counted (a repeat guess is answered, not counted). */
  accepted: boolean;
  /** Whether the stats store took it. False when the driver is unavailable. */
  persisted: boolean;
  guess: {
    clipId: string;
    guess: ClipLabel;
    label: ClipLabel;
    correct: boolean;
  } | null;
  scenario: { choice: string; correct: boolean } | null;
  /** Derived from the guesses this server accepted for this session. */
  session: SessionScore;
  /** The clip's crowd aggregate *including* the guess just recorded. */
  clipStats: ClipStats | null;
}

export type EventError =
  | { error: "invalid_json" }
  | { error: "body_too_large"; maxBytes: number }
  | { error: "invalid_event"; issues: Record<string, string[]> }
  | { error: "unknown_clip"; clipId: string };

export type EventResult =
  | { status: 200 | 202; body: EventResponse }
  | { status: 400 | 404 | 413; body: EventError };

export interface EventDeps {
  resolveClipLabel: (clipId: string) => Promise<ClipLabel | null>;
  record: (event: DemoEvent) => void;
  clipStats: (clipId: string) => ClipStats;
  statsAvailable: () => boolean;
  ledger: SessionLedger;
  now: () => number;
}

export const defaultEventDeps: EventDeps = {
  resolveClipLabel: manifestClipLabel,
  record: recordEvent,
  clipStats: getClipStats,
  statsAvailable: isStatsDriverAvailable,
  ledger: sessionLedger,
  now: () => Date.now(),
};

/**
 * Reads the body with a hard ceiling. `request.text()` alone would happily
 * buffer whatever arrives, so the declared length is checked first and the
 * stream itself is stopped as soon as an absent or lying header crosses the
 * limit.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ ok: true; value: unknown } | { ok: false; error: EventError }> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, error: { error: "body_too_large", maxBytes } };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, error: { error: "invalid_json" } };
  }

  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: { error: "body_too_large", maxBytes } };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, error: { error: "invalid_json" } };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: { error: "invalid_json" } };
  }
}

export async function handleEvent(
  raw: unknown,
  deps: EventDeps = defaultEventDeps,
): Promise<EventResult> {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "invalid_event", issues: fieldErrors(parsed.error.issues) },
    };
  }

  const event = parsed.data;
  const now = deps.now();
  switch (event.type) {
    case "guess": {
      const label = await deps.resolveClipLabel(event.clipId);
      if (label === null) {
        // A clip the pack does not contain cannot be scored, so it is not
        // counted either. Silently accepting it would poison the aggregates.
        return { status: 404, body: { error: "unknown_clip", clipId: event.clipId } };
      }

      const outcome = deps.ledger.recordGuess(
        event.sessionId,
        event.clipId,
        event.guess,
        label,
        now,
      );
      let persisted = false;
      if (outcome.accepted) {
        deps.record({
          sessionId: event.sessionId,
          station: event.station,
          lang: event.lang,
          type: "guess",
          clipId: event.clipId,
          guess: event.guess,
          correct: outcome.correct,
        });
        persisted = deps.statsAvailable();
      }

      const available = deps.statsAvailable();

      return {
        status: available ? 200 : 202,
        body: {
          accepted: outcome.accepted,
          persisted,
          guess: {
            clipId: event.clipId,
            guess: event.guess,
            label,
            correct: outcome.correct,
          },
          scenario: null,
          session: outcome.score,
          clipStats: available ? deps.clipStats(event.clipId) : null,
        },
      };
    }

    case "final_scenario": {
      const choice = event.choice;
      const correct = isFinalScenarioCorrect(choice);
      const outcome = deps.ledger.recordFinalScenario(event.sessionId, correct, now);
      let persisted = false;
      if (outcome.accepted) {
        deps.record({
          sessionId: event.sessionId,
          station: event.station,
          lang: event.lang,
          type: "final_scenario",
          choice,
          correct,
        });
        persisted = deps.statsAvailable();
      }
      const available = deps.statsAvailable();
      return {
        status: available ? 200 : 202,
        body: {
          accepted: outcome.accepted,
          persisted,
          guess: null,
          scenario: { choice, correct: outcome.correct },
          session: deps.ledger.scoreFor(event.sessionId, now),
          clipStats: null,
        },
      };
    }

    case "session_complete": {
      // The score is the server's tally, not a number the client chose.
      const score = deps.ledger.scoreFor(event.sessionId, now);
      deps.record({
        sessionId: event.sessionId,
        station: event.station,
        lang: event.lang,
        type: "session_complete",
        score: score.correct,
      });
      const available = deps.statsAvailable();
      return {
        status: available ? 200 : 202,
        body: {
          accepted: true,
          persisted: available,
          guess: null,
          scenario: null,
          session: score,
          clipStats: null,
        },
      };
    }

    case "session_reset": {
      deps.record({
        sessionId: event.sessionId,
        station: event.station,
        lang: event.lang,
        type: "session_reset",
      });
      const available = deps.statsAvailable();
      // A reset means forget: the id is dropped here as well as in the browser.
      deps.ledger.forget(event.sessionId);
      return {
        status: available ? 200 : 202,
        body: {
          accepted: true,
          persisted: available,
          guess: null,
          scenario: null,
          session: { answered: 0, correct: 0 },
          clipStats: null,
        },
      };
    }

    case "station_enter":
    case "station_complete":
    case "station_skip": {
      deps.record({
        sessionId: event.sessionId,
        station: event.station,
        lang: event.lang,
        type: event.type,
      });
      const available = deps.statsAvailable();
      return {
        status: available ? 200 : 202,
        body: {
          accepted: true,
          persisted: available,
          guess: null,
          scenario: null,
          session: deps.ledger.scoreFor(event.sessionId, now),
          clipStats: null,
        },
      };
    }

    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
