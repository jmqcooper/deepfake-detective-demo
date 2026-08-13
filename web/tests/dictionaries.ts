/**
 * The two dictionaries, read from disk.
 *
 * The app imports them as modules; the tests read the files instead, so the
 * suite needs no JSON-module support and checks exactly the bytes that ship.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { Dictionaries, Language } from "@/lib/i18n-core";

const i18nDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n");

function read(lang: Language): unknown {
  return JSON.parse(readFileSync(join(i18nDir, `${lang}.json`), "utf8")) as unknown;
}

export const dictionaries: Dictionaries = { nl: read("nl"), en: read("en") };
