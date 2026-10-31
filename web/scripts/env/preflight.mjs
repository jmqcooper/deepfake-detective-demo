#!/usr/bin/env node
/**
 * Checks the environment against .env.schema before a process starts.
 *
 * Reports name keys and nothing else. Varlock's output carries the values it read,
 * so a failed check never prints it. `next dev` can also reach "Ready" after the
 * integration refuses its environment, which is why dev stops here first.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VARLOCK_CLI = join(WEB_ROOT, "node_modules/varlock/bin/cli.js");
const IDENTITY_FILE = join(homedir(), ".config/varlock/.env.infisical");
const LOCAL_VALUES = "Using process env, .env.local and .env.";
const STORE_HELP =
  "If this machine has an Infisical identity, check the store and keyring, or set ILCC_SHARED_SECRETS=off.";

/** Injected Varlock state can stand in for a real load, so a check never inherits it. */
export const VARLOCK_METADATA = /^__?VARLOCK_/;

function runVarlock(args, env, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [VARLOCK_CLI, ...args], {
      cwd: WEB_ROOT,
      env,
      signal,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout }));
  });
}

function parseGraph(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Resolves to `{ blob, graph }` for a valid environment and `{ problem }` for any other
 * outcome. A blob is the serialized environment a Next server boots from.
 */
export async function checkEnv({ filter = "#web", overrides = {}, signal } = {}) {
  const env = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "true", ...overrides };
  for (const key of Object.keys(env)) {
    if (VARLOCK_METADATA.test(key)) delete env[key];
  }

  const args = ["load", "--format", "json-full", "--compact", "--filter", filter];
  const { status, stdout } = await runVarlock(args, env, signal);
  const graph = parseGraph(stdout);
  // A load with no schema still exits 0, with nothing checked.
  if (status === 0 && Object.keys(graph?.config ?? {}).length > 0) return { blob: stdout, graph };

  const keys = Object.keys(graph?.errors?.configItems ?? {});
  return {
    problem: keys.length
      ? `Invalid or missing: ${keys.join(", ")}. See docs/SECRETS.md.`
      : `Could not load the environment. ${STORE_HELP} See docs/SECRETS.md.`,
  };
}

function hasIdentity() {
  if (process.env.INFISICAL_CLIENT_ID) return true;
  try {
    return /^\s*INFISICAL_CLIENT_ID=\S/m.test(readFileSync(IDENTITY_FILE, "utf8"));
  } catch {
    return false;
  }
}

/** Says when a development process runs on local values alone. */
function reportStore(graph) {
  const storeEnabled = graph.sources.some(
    (source) => source.path === ".env.infisical" && source.enabled,
  );
  if (process.env.ILCC_SHARED_SECRETS === "off") {
    console.error(`[env] Shared store off. ${LOCAL_VALUES}`);
  } else if (storeEnabled && !hasIdentity()) {
    console.error(`[env] No Infisical identity on this machine. ${LOCAL_VALUES} See docs/SECRETS.md.`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: { filter: { type: "string" }, profile: { type: "string" } },
  });
  const overrides = values.profile ? { ILCC_ENV_PROFILE: values.profile } : {};
  const result = await checkEnv({ filter: values.filter, overrides });
  if (result.problem) {
    console.error(`[env] ${result.problem}`);
    process.exit(1);
  }
  reportStore(result.graph);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
