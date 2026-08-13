import { getDatabase, markDatabaseUnavailable } from "@/lib/db";
import type { SqliteDatabase } from "@/lib/db";
import type { Lang } from "@/lib/manifest-schema";

interface CommonDemoEvent {
  sessionId: string;
  station: number;
  lang: Lang;
}

/**
 * What the store holds. Note what is NOT in here: no clip audio, no transcript,
 * no IP, no user agent, no cookie, no persistent device id. `sessionId` is a
 * random UUID minted in memory and dropped on reset — it exists only to stop
 * one visitor's repeated guess from counting twice.
 *
 * `correct` and `score` are derived server-side before an event reaches this
 * module. The browser never asserts either one.
 */
export type DemoEvent =
  | (CommonDemoEvent & {
      type: "station_enter" | "station_complete" | "station_skip" | "session_reset";
    })
  | (CommonDemoEvent & {
      type: "guess";
      clipId: string;
      guess: "real" | "fake";
      correct: boolean;
    })
  | (CommonDemoEvent & { type: "session_complete"; score: number })
  | (CommonDemoEvent & { type: "final_scenario"; choice: string; correct: boolean });

export interface ClipStats {
  clipId: string;
  guesses: number;
  fooledPct: number | null;
}

export interface SummaryStats {
  sessionsToday: number;
  avgScore: number | null;
  hardestClip: { clipId: string; fooledPct: number } | null;
  /** Share of visitors who chose "call back on a number you already have". */
  verifyFirstPct: number | null;
}

export type StatsDriverName = "memory" | "sqlite" | "none";

export interface StatsDriver {
  readonly name: StatsDriverName;
  recordEvent(event: DemoEvent): void;
  getClipStats(clipId: string): ClipStats;
  getSummary(): SummaryStats;
  isAvailable(): boolean;
}

/** Below this many guesses a percentage is noise, so the UI hides it. */
export const MIN_GUESSES_FOR_PERCENTAGE = 10;

/* --------------------------------------------------------------- retention */

/**
 * Bounded on both axes. A kiosk that runs for two years unattended must not
 * grow a database nobody prunes, and the memory driver must not become the
 * process's largest object.
 */
export const RETENTION_DAYS = clampInt(process.env.STATS_RETENTION_DAYS, 90, 1, 3650);
export const MAX_EVENT_ROWS = clampInt(process.env.STATS_MAX_ROWS, 500_000, 1_000, 10_000_000);
export const MAX_MEMORY_EVENTS = clampInt(
  process.env.STATS_MAX_MEMORY_EVENTS,
  50_000,
  100,
  1_000_000,
);
const PRUNE_INTERVAL_MS = 30 * 60 * 1000;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function retentionCutoff(now: Date, days = RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function shouldPrune(lastPruneAt: number | null, now: number): boolean {
  return lastPruneAt === null || now - lastPruneAt >= PRUNE_INTERVAL_MS;
}

/** Keeps the newest `max` items, dropping from the front. */
export function trimToCap<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(items.length - max);
}

/* ------------------------------------------------------------------ shared */

interface ClipAggregateRow {
  guesses: number;
  wrong: number | null;
}

interface SessionAggregateRow {
  sessionsToday: number;
  avgScore: number | null;
}

interface HardestClipRow {
  clipId: string;
  fooledPct: number;
}

interface ScenarioRow {
  answers: number;
  verified: number | null;
}

function emptyClipStats(clipId: string): ClipStats {
  return { clipId, guesses: 0, fooledPct: null };
}

function emptySummary(): SummaryStats {
  return { sessionsToday: 0, avgScore: null, hardestClip: null, verifyFirstPct: null };
}

function roundedPercentage(part: number, total: number): number {
  return Math.round((part / total) * 100);
}

const DEFAULT_REPORT_TIMEZONE = "Europe/Amsterdam";

function reportingTimezone(): string {
  const configured = process.env.REPORT_TIMEZONE ?? process.env.TZ ?? DEFAULT_REPORT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: configured }).format();
    return configured;
  } catch {
    console.error(
      `Invalid reporting timezone '${configured}'; using ${DEFAULT_REPORT_TIMEZONE}.`,
    );
    return DEFAULT_REPORT_TIMEZONE;
  }
}

const REPORT_TIMEZONE = reportingTimezone();

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function datePartsAt(instant: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as unknown as DateParts;
}

function utcForLocalMidnight(
  date: Pick<DateParts, "year" | "month" | "day">,
  timeZone: string,
): Date {
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = localAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = datePartsAt(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = localAsUtc - (representedAsUtc - candidate);
  }
  return new Date(candidate);
}

function reportDayBounds(now = new Date()): { start: Date; end: Date } {
  const local = datePartsAt(now, REPORT_TIMEZONE);
  const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return {
    start: utcForLocalMidnight(local, REPORT_TIMEZONE),
    end: utcForLocalMidnight(
      {
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
      },
      REPORT_TIMEZONE,
    ),
  };
}

function sqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/* ----------------------------------------------------------------- drivers */

class UnavailableDriver implements StatsDriver {
  readonly name: StatsDriverName = "none";

  recordEvent(): void {}

  getClipStats(clipId: string): ClipStats {
    return emptyClipStats(clipId);
  }

  getSummary(): SummaryStats {
    return emptySummary();
  }

  isAvailable(): boolean {
    return false;
  }
}

class SqliteDriver implements StatsDriver {
  readonly name: StatsDriverName = "sqlite";
  private database: SqliteDatabase | null;
  private lastPruneAt: number | null = null;

  constructor(database: SqliteDatabase) {
    this.database = database;
  }

  private fail(error: unknown): void {
    this.database = null;
    markDatabaseUnavailable(error);
  }

  /** Age-based first, then a hard row cap as a backstop. Cheap and infrequent. */
  private prune(): void {
    const database = this.database;
    if (!database) return;
    const now = Date.now();
    if (!shouldPrune(this.lastPruneAt, now)) return;
    this.lastPruneAt = now;
    try {
      database
        .prepare("DELETE FROM events WHERE ts < ?")
        .run(sqliteTimestamp(retentionCutoff(new Date(now))));
      database
        .prepare(
          `DELETE FROM events WHERE id <= (
             SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?
           )`,
        )
        .run(MAX_EVENT_ROWS);
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  recordEvent(event: DemoEvent): void {
    if (!this.database) {
      return;
    }

    try {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO events
            (session_id, station, type, clip_id, guess, correct, score, choice, lang)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.sessionId,
          event.station,
          event.type,
          event.type === "guess" ? event.clipId : null,
          event.type === "guess" ? event.guess : null,
          event.type === "guess" || event.type === "final_scenario"
            ? Number(event.correct)
            : null,
          event.type === "session_complete" ? event.score : null,
          event.type === "final_scenario" ? event.choice : null,
          event.lang,
        );
    } catch (error: unknown) {
      this.fail(error);
      return;
    }
    this.prune();
  }

  getClipStats(clipId: string): ClipStats {
    if (!this.database) {
      return emptyClipStats(clipId);
    }

    try {
      const row = this.database
        .prepare(
          `SELECT COUNT(*) AS guesses,
                  SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS wrong
           FROM events
           WHERE type = 'guess' AND clip_id = ? AND correct IN (0, 1)`,
        )
        .get(clipId) as ClipAggregateRow;
      const guesses = row.guesses;
      return {
        clipId,
        guesses,
        fooledPct:
          guesses < MIN_GUESSES_FOR_PERCENTAGE
            ? null
            : roundedPercentage(row.wrong ?? 0, guesses),
      };
    } catch (error: unknown) {
      this.fail(error);
      return emptyClipStats(clipId);
    }
  }

  getSummary(): SummaryStats {
    if (!this.database) {
      return emptySummary();
    }

    try {
      const { start, end } = reportDayBounds();
      const sessions = this.database
        .prepare(
          `WITH first_completion AS (
             SELECT session_id, MIN(id) AS event_id
             FROM events
             WHERE type = 'session_complete' AND ts >= ? AND ts < ?
             GROUP BY session_id
           )
           SELECT COUNT(*) AS sessionsToday, AVG(events.score) AS avgScore
           FROM first_completion
           JOIN events ON events.id = first_completion.event_id`,
        )
        .get(sqliteTimestamp(start), sqliteTimestamp(end)) as SessionAggregateRow;
      const hardest = this.database
        .prepare(
          `SELECT clip_id AS clipId,
                  ROUND(100.0 * SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) / COUNT(*)) AS fooledPct
           FROM events
           WHERE type = 'guess' AND clip_id IS NOT NULL AND correct IN (0, 1)
           GROUP BY clip_id
           HAVING COUNT(*) >= ?
           ORDER BY fooledPct DESC, clip_id ASC
           LIMIT 1`,
        )
        .get(MIN_GUESSES_FOR_PERCENTAGE) as HardestClipRow | undefined;
      const scenario = this.database
        .prepare(
          `SELECT COUNT(*) AS answers,
                  SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS verified
           FROM events
           WHERE type = 'final_scenario' AND correct IN (0, 1)`,
        )
        .get() as ScenarioRow;

      return {
        sessionsToday: sessions.sessionsToday,
        avgScore:
          sessions.avgScore === null ? null : Math.round(sessions.avgScore * 10) / 10,
        hardestClip: hardest ?? null,
        verifyFirstPct:
          scenario.answers < MIN_GUESSES_FOR_PERCENTAGE
            ? null
            : roundedPercentage(scenario.verified ?? 0, scenario.answers),
      };
    } catch (error: unknown) {
      this.fail(error);
      return emptySummary();
    }
  }

  isAvailable(): boolean {
    return this.database !== null;
  }
}

type MemoryEvent = DemoEvent & { recordedAt: Date };
type MemoryGuessEvent = Extract<MemoryEvent, { type: "guess" }>;
type MemorySessionCompleteEvent = Extract<MemoryEvent, { type: "session_complete" }>;
type MemoryScenarioEvent = Extract<MemoryEvent, { type: "final_scenario" }>;

class MemoryDriver implements StatsDriver {
  readonly name: StatsDriverName = "memory";
  private events: MemoryEvent[] = [];
  private guesses = new Map<string, MemoryGuessEvent>();

  recordEvent(event: DemoEvent): void {
    const stored = { ...event, recordedAt: new Date() } as MemoryEvent;
    if (event.type === "guess") {
      const key = `${event.sessionId} ${event.clipId}`;
      if (this.guesses.has(key)) {
        return;
      }
      this.guesses.set(key, stored as MemoryGuessEvent);
      if (this.guesses.size > MAX_MEMORY_EVENTS) {
        const oldest = this.guesses.keys().next();
        if (!oldest.done) this.guesses.delete(oldest.value);
      }
    }
    this.events.push(stored);
    this.events = trimToCap(this.events, MAX_MEMORY_EVENTS);
  }

  getClipStats(clipId: string): ClipStats {
    const guesses = [...this.guesses.values()].filter((event) => event.clipId === clipId);
    const wrong = guesses.filter((event) => event.correct === false).length;
    return {
      clipId,
      guesses: guesses.length,
      fooledPct:
        guesses.length < MIN_GUESSES_FOR_PERCENTAGE
          ? null
          : roundedPercentage(wrong, guesses.length),
    };
  }

  getSummary(): SummaryStats {
    const { start, end } = reportDayBounds();
    const completedToday = this.events.filter(
      (event): event is MemorySessionCompleteEvent =>
        event.type === "session_complete" &&
        event.recordedAt >= start &&
        event.recordedAt < end,
    );
    const firstCompletionBySession = new Map<string, MemorySessionCompleteEvent>();
    for (const event of completedToday) {
      if (!firstCompletionBySession.has(event.sessionId)) {
        firstCompletionBySession.set(event.sessionId, event);
      }
    }
    const scored = [...firstCompletionBySession.values()];
    const clipStats = [
      ...new Set([...this.guesses.values()].map((event) => event.clipId)),
    ]
      .map((clipId) => this.getClipStats(clipId))
      .filter(
        (stats): stats is ClipStats & { fooledPct: number } => stats.fooledPct !== null,
      );
    const hardestClip = [...clipStats].sort(
      (left, right) =>
        right.fooledPct - left.fooledPct || left.clipId.localeCompare(right.clipId),
    )[0];

    const scenarioAnswers = this.events.filter(
      (event): event is MemoryScenarioEvent => event.type === "final_scenario",
    );
    const verified = scenarioAnswers.filter((event) => event.correct).length;

    return {
      sessionsToday: firstCompletionBySession.size,
      avgScore:
        scored.length === 0
          ? null
          : Math.round(
              (scored.reduce((sum, event) => sum + event.score, 0) / scored.length) * 10,
            ) / 10,
      hardestClip: hardestClip
        ? { clipId: hardestClip.clipId, fooledPct: hardestClip.fooledPct }
        : null,
      verifyFirstPct:
        scenarioAnswers.length < MIN_GUESSES_FOR_PERCENTAGE
          ? null
          : roundedPercentage(verified, scenarioAnswers.length),
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/** Exported for tests: a driver with no ambient process or file-system state. */
export function createMemoryDriver(): StatsDriver {
  return new MemoryDriver();
}

function createDriver(): StatsDriver {
  type DriverName = "memory" | "sqlite";
  const configuredName = process.env.STATS_DRIVER ?? "sqlite";
  const driverName: DriverName | null =
    configuredName === "memory" || configuredName === "sqlite" ? configuredName : null;

  switch (driverName) {
    case "memory":
      return new MemoryDriver();
    case "sqlite": {
      const database = getDatabase();
      return database ? new SqliteDriver(database) : new UnavailableDriver();
    }
    case null:
      console.error(`Unknown STATS_DRIVER '${configuredName}'; stats are disabled.`);
      return new UnavailableDriver();
    default: {
      const exhaustiveCheck: never = driverName;
      return exhaustiveCheck;
    }
  }
}

let driverInstance: StatsDriver | undefined;

function driver(): StatsDriver {
  driverInstance ??= createDriver();
  return driverInstance;
}

export function recordEvent(event: DemoEvent): void {
  driver().recordEvent(event);
}

export function getClipStats(clipId: string): ClipStats {
  return driver().getClipStats(clipId);
}

export function getSummary(): SummaryStats {
  return driver().getSummary();
}

export function isStatsDriverAvailable(): boolean {
  return driver().isAvailable();
}

export function statsDriverName(): StatsDriverName {
  return driver().name;
}
