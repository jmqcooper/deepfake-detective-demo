#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);
let Database;
try {
  // Runtime image: the standalone bundle exposes its dependencies from /app.
  Database = requireFromHere("better-sqlite3");
} catch (error) {
  // Source checkout: dependencies are installed under web/node_modules.
  if (error?.code !== "MODULE_NOT_FOUND") throw error;
  const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
  Database = requireFromWeb("better-sqlite3");
}
const command = process.argv[2];
const databasePath = resolve(process.env.DATABASE_PATH ?? "web/data/stats.db");
const backupDir = resolve(process.env.BACKUP_DIR ?? "backups");

if (!command || !["backup", "reset", "prune"].includes(command)) {
  console.error("usage: node ops/stats-maintenance.mjs backup|reset|prune [--yes]");
  process.exit(2);
}

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(backupDir, { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");

async function backup(label = "manual") {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = resolve(backupDir, `stats-${label}-${stamp}.db`);
  await db.backup(destination);
  console.log(destination);
}

try {
  if (command === "backup") {
    await backup();
  } else if (command === "prune") {
    const days = Number.parseInt(process.env.STATS_RETENTION_DAYS ?? "90", 10);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
      throw new Error("STATS_RETENTION_DAYS must be an integer from 1 to 3650");
    }
    const result = db.prepare(
      "DELETE FROM events WHERE ts < datetime('now', ?)"
    ).run(`-${days} days`);
    console.log(`pruned ${result.changes} event(s) older than ${days} days`);
  } else {
    if (!process.argv.includes("--yes")) {
      throw new Error("reset requires --yes; a timestamped backup is created first");
    }
    await backup("before-reset");
    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM events").run();
      for (const table of ["sessions", "answers"]) {
        const exists = db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
        ).get(table);
        if (exists) db.prepare(`DELETE FROM ${table}`).run();
      }
    });
    transaction();
    console.log("museum statistics reset");
  }
} finally {
  db.close();
}
