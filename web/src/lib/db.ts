import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/** `choice` carries the final-scenario answer; everything else is unchanged. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL DEFAULT (datetime('now')),
  session_id TEXT    NOT NULL,
  station    INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  clip_id    TEXT,
  guess      TEXT,
  correct    INTEGER,
  score      INTEGER,
  choice     TEXT,
  lang       TEXT    NOT NULL DEFAULT 'nl'
);
CREATE INDEX IF NOT EXISTS idx_events_clip ON events(clip_id) WHERE clip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
`;

/**
 * The durable half of guess de-duplication. `SessionLedger` catches repeats
 * inside a live process; this catches them across a restart, without a SELECT
 * before every write.
 *
 * Kept out of SCHEMA and made non-fatal on purpose: a museum's existing
 * database may already contain duplicate guesses from before the ledger
 * existed, and refusing to open it would take the exhibit's stats down to fix a
 * historical accounting nicety.
 */
const GUESS_UNIQUE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_guess_once
  ON events(session_id, clip_id) WHERE type = 'guess'
`;

interface SqliteStatement {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): unknown;
}

export interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  pragma(source: string): unknown;
  prepare(sql: string): SqliteStatement;
}

interface BetterSqlite3Constructor {
  new (filename: string): SqliteDatabase;
}

interface ColumnRow {
  name: string;
}

const require = createRequire(import.meta.url);
let database: SqliteDatabase | null | undefined;
let didLogDatabaseError = false;

function logDatabaseError(error: unknown): void {
  if (didLogDatabaseError) {
    return;
  }

  didLogDatabaseError = true;
  console.error("Stats database unavailable; continuing without persisted stats.", error);
}

/** Adds columns an older kiosk's database file predates, without losing its rows. */
function migrate(connection: SqliteDatabase): void {
  const columns = connection.prepare("PRAGMA table_info(events)").all() as ColumnRow[];
  const present = new Set(columns.map((column) => column.name));
  if (!present.has("choice")) {
    connection.exec("ALTER TABLE events ADD COLUMN choice TEXT");
  }

  try {
    connection.exec(GUESS_UNIQUE_INDEX);
  } catch (error: unknown) {
    console.warn(
      "Could not add the unique guess index; existing rows probably contain " +
        "duplicates from before de-duplication existed. Stats still work.",
      error,
    );
  }
}

export function getDatabase(): SqliteDatabase | null {
  if (database !== undefined) {
    return database;
  }

  try {
    const configuredPath = process.env.DATABASE_PATH ?? "./data/stats.db";
    const databasePath = resolve(process.cwd(), configuredPath);
    mkdirSync(dirname(databasePath), { recursive: true });

    const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;
    const connection = new BetterSqlite3(databasePath);
    connection.pragma("journal_mode = WAL");
    connection.exec(SCHEMA);
    migrate(connection);
    database = connection;
  } catch (error: unknown) {
    database = null;
    logDatabaseError(error);
  }

  return database;
}

export function markDatabaseUnavailable(error: unknown): void {
  if (database) {
    try {
      database.close();
    } catch {
      // The original failure is the useful error to report.
    }
  }
  database = null;
  logDatabaseError(error);
}
