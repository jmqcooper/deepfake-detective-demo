import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
  lang       TEXT    NOT NULL DEFAULT 'nl'
);
CREATE INDEX IF NOT EXISTS idx_events_clip ON events(clip_id) WHERE clip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
`;

interface SqliteStatement {
  get(...parameters: unknown[]): unknown;
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
