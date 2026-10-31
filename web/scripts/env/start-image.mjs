#!/usr/bin/env node
/**
 * The container image's entry point.
 *
 * It checks the environment, then becomes the server in this same process, so node
 * stays PID 1 and `docker stop` reaches it directly. The profile is forced here: the
 * image has no shared store, and a container must never require the optional voice add-on.
 */

import { checkEnv, VARLOCK_METADATA } from "./preflight.mjs";

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

for (const key of Object.keys(process.env)) {
  if (VARLOCK_METADATA.test(key)) delete process.env[key];
}

const check = new AbortController();
// PID 1 ignores a signal it has no handler for, and the server has not installed its own.
const stopDuringCheck = (signal) => {
  check.abort();
  process.exit(SIGNAL_EXIT_CODES[signal]);
};
process.on("SIGINT", stopDuringCheck);
process.on("SIGTERM", stopDuringCheck);

const result = await checkEnv({
  overrides: { ILCC_ENV_PROFILE: "installed", ILCC_SHARED_SECRETS: "off" },
  signal: check.signal,
});
if (result.problem) {
  console.error(`[env] ${result.problem}`);
  process.exit(1);
}

process.off("SIGINT", stopDuringCheck);
process.off("SIGTERM", stopDuringCheck);
process.env.__VARLOCK_ENV = result.blob;
await import("../../server.js");
