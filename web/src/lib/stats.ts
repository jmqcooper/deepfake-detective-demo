import { getDatabase, markDatabaseUnavailable } from "@/lib/db";
import type { SqliteDatabase } from "@/lib/db";

interface CommonDemoEvent {
  sessionId: string;
  station: number;
  lang: "nl" | "en";
}

export type DemoEvent =
  | (CommonDemoEvent & { type: "station_enter" | "station_complete" })
  | (CommonDemoEvent & {
      type: "guess";
      clipId: string;
      guess: "real" | "fake";
      correct: boolean;
    })
  | (CommonDemoEvent & { type: "session_complete"; score: number });

export interface ClipStats {
  clipId: string;
  guesses: number;
  fooledPct: number | null;
}

export interface SummaryStats {
  sessionsToday: number;
  avgScore: number | null;
  hardestClip: { clipId: string; fooledPct: number } | null;
}

interface StatsDriver {
  recordEvent(event: DemoEvent): void;
  getClipStats(clipId: string): ClipStats;
  getSummary(): SummaryStats;
  isAvailable(): boolean;
}

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

function emptyClipStats(clipId: string): ClipStats {
  return { clipId, guesses: 0, fooledPct: null };
}

function emptySummary(): SummaryStats {
  return { sessionsToday: 0, avgScore: null, hardestClip: null };
}

function roundedPercentage(wrong: number, total: number): number {
  return Math.round((wrong / total) * 100);
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

class UnavailableDriver implements StatsDriver {
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
  private database: SqliteDatabase | null;

  constructor(database: SqliteDatabase) {
    this.database = database;
  }

  private fail(error: unknown): void {
    this.database = null;
    markDatabaseUnavailable(error);
  }

  recordEvent(event: DemoEvent): void {
    if (!this.database) {
      return;
    }

    try {
      if (event.type === "guess" && event.clipId) {
        const existing = this.database
          .prepare(
            `SELECT 1 FROM events
             WHERE type = 'guess' AND session_id = ? AND clip_id = ? LIMIT 1`,
          )
          .get(event.sessionId, event.clipId);
        if (existing) {
          return;
        }
      }

      this.database
        .prepare(
          `INSERT INTO events
            (session_id, station, type, clip_id, guess, correct, score, lang)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.sessionId,
          event.station,
          event.type,
          event.type === "guess" ? event.clipId : null,
          event.type === "guess" ? event.guess : null,
          event.type === "guess" ? Number(event.correct) : null,
          event.type === "session_complete" ? event.score : null,
          event.lang,
        );
    } catch (error: unknown) {
      this.fail(error);
    }
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
        fooledPct: guesses < 10 ? null : roundedPercentage(row.wrong ?? 0, guesses),
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
           HAVING COUNT(*) >= 10
           ORDER BY fooledPct DESC, clip_id ASC
           LIMIT 1`,
        )
        .get() as HardestClipRow | undefined;

      return {
        sessionsToday: sessions.sessionsToday,
        avgScore: sessions.avgScore === null ? null : Math.round(sessions.avgScore * 10) / 10,
        hardestClip: hardest ?? null,
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

class MemoryDriver implements StatsDriver {
  private readonly events: MemoryEvent[] = [];
  private readonly guesses = new Map<string, MemoryGuessEvent>();

  recordEvent(event: DemoEvent): void {
    const stored = { ...event, recordedAt: new Date() };
    if (event.type === "guess" && event.clipId) {
      const key = `${event.sessionId}\u0000${event.clipId}`;
      if (this.guesses.has(key)) {
        return;
      }
      this.guesses.set(key, stored as MemoryGuessEvent);
    }
    this.events.push(stored);
  }

  getClipStats(clipId: string): ClipStats {
    const guesses = [...this.guesses.values()].filter((event) => event.clipId === clipId);
    const wrong = guesses.filter((event) => event.correct === false).length;
    return {
      clipId,
      guesses: guesses.length,
      fooledPct: guesses.length < 10 ? null : roundedPercentage(wrong, guesses.length),
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
    const clipStats = new Set([...this.guesses.values()].map((event) => event.clipId))
      .values()
      .map((clipId) => this.getClipStats(clipId))
      .filter(
        (stats): stats is ClipStats & { fooledPct: number } => stats.fooledPct !== null,
      );
    const hardestClip = [...clipStats].sort(
      (left, right) =>
        right.fooledPct - left.fooledPct || left.clipId.localeCompare(right.clipId),
    )[0];

    return {
      sessionsToday: firstCompletionBySession.size,
      avgScore:
        scored.length === 0
          ? null
          : Math.round((scored.reduce((sum, event) => sum + event.score, 0) / scored.length) * 10) /
            10,
      hardestClip: hardestClip
        ? { clipId: hardestClip.clipId, fooledPct: hardestClip.fooledPct }
        : null,
    };
  }

  isAvailable(): boolean {
    return true;
  }
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

const driver = createDriver();

export function recordEvent(event: DemoEvent): void {
  driver.recordEvent(event);
}

export function getClipStats(clipId: string): ClipStats {
  return driver.getClipStats(clipId);
}

export function getSummary(): SummaryStats {
  return driver.getSummary();
}

export function isStatsDriverAvailable(): boolean {
  return driver.isAvailable();
}
