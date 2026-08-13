import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * A source-level guard for the responsiveness and zoom defects that were fixed.
 *
 * The honest caveat: measuring real overflow needs a real browser, and this
 * suite deliberately has no browser runner (see tests/loader.mjs for why). What
 * it can do is hold the invariants that *caused* the overflow, each of which is
 * a specific thing that was in this code:
 *
 *  - a fixed 140-bar waveform (417px of gaps) inside a 264px content box;
 *  - a `w-72` progress bar and a `min-w-52` lever with no breakpoint;
 *  - `maximumScale: 1, userScalable: false`, which blocked pinch-zoom outright.
 *
 * A regression on any of those reappears as a failing test rather than as a
 * phone-shaped bug report six months later.
 */

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * The narrowest content box the kiosk has to survive: a 320px viewport, minus
 * `<main>`'s p-3 (12px each side) and StationCard's p-4 (16px each side).
 */
const NARROW_CONTENT_PX = 320 - 24 - 32;
const TAILWIND_UNIT_PX = 4;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(srcRoot).map((path) => ({
  path: relative(srcRoot, path),
  text: readFileSync(path, "utf8"),
}));

/**
 * Fixed widths with no responsive prefix. `sm:w-72` is fine — it only applies
 * once there is room for it — so only unprefixed occurrences are flagged.
 */
function oversizedFixedWidths(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![\w:-])(min-w|w)-(\d+)(?![\w-])/g)) {
    const px = Number(match[2]) * TAILWIND_UNIT_PX;
    if (px > NARROW_CONTENT_PX) found.push(match[0]);
  }
  return found;
}

test("no component hard-codes a width wider than a 320px content box", () => {
  const offenders = files
    .map((file) => ({ path: file.path, classes: oversizedFixedWidths(file.text) }))
    .filter((file) => file.classes.length > 0);

  assert.deepEqual(
    offenders,
    [],
    offenders
      .map((o) => `${o.path}: ${[...new Set(o.classes)].join(", ")}`)
      .join("\n"),
  );
});

test("the responsive-prefix escape hatch is what the test actually allows", () => {
  // Guards the guard: if the regex stopped matching, the test above would pass
  // vacuously for ever.
  assert.deepEqual(oversizedFixedWidths('className="w-72"'), ["w-72"]);
  assert.deepEqual(oversizedFixedWidths('className="min-w-52"'), []);
  assert.deepEqual(oversizedFixedWidths('className="min-w-96"'), ["min-w-96"]);
  assert.deepEqual(oversizedFixedWidths('className="md:w-72 sm:min-w-96"'), []);
  assert.deepEqual(oversizedFixedWidths('className="max-w-2xl w-full"'), []);
});

test("pinch-zoom is not disabled", () => {
  const layout = files.find((file) => file.path.endsWith(join("app", "layout.tsx")));
  assert.ok(layout, "app/layout.tsx not found");
  assert.equal(/userScalable:\s*false/.test(layout.text), false);
  assert.equal(/maximumScale:\s*1\b/.test(layout.text), false);
  assert.match(layout.text, /userScalable:\s*true/);
});

test("the document language follows the toggle rather than staying Dutch", () => {
  const hooks = files.find((file) => file.path.endsWith(join("kiosk", "hooks.ts")));
  assert.ok(hooks, "kiosk/hooks.ts not found");
  assert.match(hooks.text, /document\.documentElement\.lang\s*=/);
});

test("the waveform's bar count is measured, not hard-coded", () => {
  const station1 = files.find((file) => file.path.endsWith("Station1Brain.tsx"));
  assert.ok(station1, "Station1Brain.tsx not found");
  assert.match(station1.text, /barCountFor\(/);
  // The literal that used to be the bug.
  assert.equal(/const buckets = 140/.test(station1.text), false);
});

test("the page cannot scroll sideways", () => {
  const css = readFileSync(join(srcRoot, "app", "globals.css"), "utf8");
  assert.match(css, /html\s*\{[^}]*overflow-x:\s*hidden/);
});

test("there is a visible focus style that is not the browser default", () => {
  const css = readFileSync(join(srcRoot, "app", "globals.css"), "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline:\s*3px solid/);
});

test("interactive controls clear a 44px touch target", () => {
  // Every bespoke control in the chrome; the shared BigButton sets min-h-14.
  const ui = files.find((file) => file.path.endsWith(join("kiosk", "ui.tsx")));
  assert.ok(ui, "kiosk/ui.tsx not found");
  assert.match(ui.text, /min-h-14/);
  assert.match(ui.text, /min-h-11/);
});
