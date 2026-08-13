/**
 * Resolves the `@/…` path alias for `node --test`.
 *
 * The suite runs on Node's built-in test runner and its built-in TypeScript
 * type stripping — no bundler, no transpiler, no extra dependencies. That
 * matters for a project whose promise is "one Next.js app, no GPU, runs
 * anywhere": adding a test toolchain heavier than the app itself would be a
 * new thing to keep alive.
 *
 * The two things Node cannot do out of the box are the TypeScript path alias
 * and extensionless imports, so this does exactly those and nothing else.
 */

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".json", "/index.ts", "/index.tsx"];

function resolveAlias(specifier) {
  const base = join(srcRoot, specifier.slice(2));
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const file = resolveAlias(specifier);
      if (file) {
        return {
          url: pathToFileURL(file).href,
          shortCircuit: true,
          // JSON needs its type declared; Node refuses to guess.
          importAttributes: file.endsWith(".json") ? { type: "json" } : undefined,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});
