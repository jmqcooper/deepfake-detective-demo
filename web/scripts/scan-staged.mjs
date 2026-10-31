#!/usr/bin/env node
/**
 * Scans the copy of the Git index that .githooks/pre-commit made.
 *
 * A bare `varlock scan` reads every source again, and in a credential proxy it reads
 * placeholders. So this proves it runs outside a proxy with a schema that holds nothing
 * private, loads the whole contract once, and gives the scanner those values in its
 * environment. The exit status is the only result, because Varlock's output carries what
 * it read.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VARLOCK_METADATA } from "./env/preflight.mjs";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VARLOCK_CLI = join(WEB_ROOT, "node_modules/varlock/bin/cli.js");
const PROXY_MARKER = /^__?VARLOCK_PROXY_/;
const DECLARED_ITEM = /^[A-Z][A-Z0-9_]*=/m;
const GENERATED_HEADER = "# @defaultRequired=false\n# ---\n";
// package.json narrows a plain load to #web, and internal items hold the store's own identity.
const LOAD_WHOLE_CONTRACT = ["load", "--format", "json-full", "--filter", "*", "--include-internal", "--skip-cache"];

function runVarlock(args, env) {
  return spawnSync(process.execPath, [VARLOCK_CLI, ...args], {
    cwd: WEB_ROOT,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Varlock also knows a proxy by process ancestry, so clearing its markers proves nothing. */
function outsideProxy(env, schema) {
  writeFileSync(schema, `${GENERATED_HEADER}# @sensitive=false\nSCAN_CONTEXT=1\n`, { mode: 0o600 });
  const load = ["load", "--format", "json-full", "--skip-cache", "--path", schema];
  const { status, stdout } = runVarlock(load, env);
  const { config, runtime } = JSON.parse(stdout);
  return status === 0 && "SCAN_CONTEXT" in config && !runtime?.proxy?.active;
}

/** A bad public value cannot hide a secret, and the commit does not depend on it. */
function onlyPublicItemsFailed({ config, errors }) {
  const failed = Object.keys(errors?.configItems ?? {});
  return !errors?.root && failed.length > 0 && failed.every((key) => config[key]?.isSensitive === false);
}

function captureSecrets(env) {
  const { status, stdout } = runVarlock(LOAD_WHOLE_CONTRACT, env);
  const graph = JSON.parse(stdout);
  const items = Object.values(graph.config);
  if (items.length === 0 || graph.runtime?.proxy?.active) return null;
  if (status !== 0 && !onlyPublicItemsFailed(graph)) return null;
  const secrets = items.filter((item) => item.isSensitive && typeof item.value === "string" && item.value);
  return new Set(secrets.map((item) => item.value));
}

function stagedCopyIsClean(indexCopy) {
  if (Object.keys(process.env).some((key) => PROXY_MARKER.test(key))) return false;
  // With no schema a load still succeeds on the env files alone, without the store.
  if (!DECLARED_ITEM.test(readFileSync(join(WEB_ROOT, ".env.schema"), "utf8"))) return false;

  const env = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "true" };
  for (const key of Object.keys(env)) {
    if (VARLOCK_METADATA.test(key)) delete env[key];
  }

  const directory = join(indexCopy, "schema");
  mkdirSync(directory, { mode: 0o700 });
  const schema = join(directory, ".env.schema");
  if (!outsideProxy(env, schema)) return false;
  const secrets = captureSecrets(env);
  if (!secrets) return false;

  const declarations = [...secrets].map((secret, index) => {
    env[`SCAN_VALUE_${index}`] = secret;
    return `# @sensitive @type=string\nSCAN_VALUE_${index}=`;
  });
  writeFileSync(schema, `${GENERATED_HEADER}\n${declarations.join("\n\n")}\n`);
  return runVarlock(["scan", join(indexCopy, "files"), "--path", schema], env).status === 0;
}

try {
  process.exitCode = stagedCopyIsClean(process.argv[2]) ? 0 : 1;
} catch {
  process.exitCode = 1;
}
