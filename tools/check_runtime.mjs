#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const major = Number.parseInt(process.versions.node.split(".")[0], 10);
if (major !== 22) {
  throw new Error(`Node 22 is required for build/runtime parity; found ${process.version}`);
}

const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const Database = requireFromWeb("better-sqlite3");
const temporary = mkdtempSync(join(tmpdir(), "nemo-sqlite-smoke-"));
try {
  const db = new Database(join(temporary, "smoke.db"));
  db.exec("CREATE TABLE smoke (value INTEGER NOT NULL); INSERT INTO smoke VALUES (22)");
  const row = db.prepare("SELECT value FROM smoke").get();
  db.close();
  if (row?.value !== 22) throw new Error("native SQLite smoke query returned the wrong value");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log(`runtime OK: Node ${process.versions.node}, native better-sqlite3 loaded`);
