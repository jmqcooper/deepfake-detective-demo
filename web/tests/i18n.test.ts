import test from "node:test";
import assert from "node:assert/strict";

import {
  collectKeys,
  interpolate,
  lookup,
  placeholdersIn,
  translate,
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  LANGUAGES,
} from "@/lib/i18n-core";
import { dictionaries } from "./dictionaries.ts";

const nlKeys = collectKeys(dictionaries.nl).sort();
const enKeys = collectKeys(dictionaries.en).sort();

test("Dutch is the default and English the fallback", () => {
  assert.equal(DEFAULT_LANGUAGE, "nl");
  assert.equal(FALLBACK_LANGUAGE, "en");
  assert.deepEqual([...LANGUAGES], ["nl", "en"]);
});

test("both dictionaries carry exactly the same keys", () => {
  const missingInEn = nlKeys.filter((key) => !enKeys.includes(key));
  const missingInNl = enKeys.filter((key) => !nlKeys.includes(key));
  assert.deepEqual(missingInEn, [], "keys missing from en.json");
  assert.deepEqual(missingInNl, [], "keys missing from nl.json");
});

test("no string is left empty in either language", () => {
  for (const lang of LANGUAGES) {
    for (const key of collectKeys(dictionaries[lang])) {
      const value = lookup(dictionaries[lang], key) ?? "";
      assert.ok(value.trim().length > 0, `${lang}: ${key} is empty`);
    }
  }
});

test("a translated string expects the same placeholders in both languages", () => {
  for (const key of nlKeys) {
    const dutch = lookup(dictionaries.nl, key) ?? "";
    const english = lookup(dictionaries.en, key) ?? "";
    assert.deepEqual(
      placeholdersIn(dutch),
      placeholdersIn(english),
      // A mismatch renders as a literal "{pct}" in one language only.
      `${key}: placeholders differ (nl ${placeholdersIn(dutch)}, en ${placeholdersIn(english)})`,
    );
  }
});

test("a missing key falls back to English, then to the key itself", () => {
  const dicts = { nl: { only: { en: "x" } }, en: { shared: "English copy" } };
  assert.equal(translate(dicts, "nl", "shared"), "English copy");
  assert.equal(translate(dicts, "nl", "nothing.here"), "nothing.here");
  assert.equal(translate(dicts, "en", "nothing.here"), "nothing.here");
});

test("a key that resolves to an object is treated as missing", () => {
  const dicts = { nl: { group: { child: "x" } }, en: {} };
  assert.equal(translate(dicts, "nl", "group"), "group");
});

test("an unknown placeholder is left visible rather than rendered as undefined", () => {
  assert.equal(interpolate("{a} and {b}", { a: "1" }), "1 and {b}");
  assert.equal(interpolate("{pct}% fooled", { pct: 71 }), "71% fooled");
  assert.equal(interpolate("no vars"), "no vars");
});

/* ------------------------------------------------------- editorial checks */

test("the take-home advice is present in both languages", () => {
  for (const lang of LANGUAGES) {
    for (const key of ["station5.tip1", "final.takeaway", "final.why.callback"]) {
      const copy = lookup(dictionaries[lang], key) ?? "";
      assert.ok(copy.length > 20, `${lang}: ${key} is missing or too short`);
    }
  }
});

test("the clue copy is framed as a clue rather than as proof", () => {
  // The station used to tell an eight-year-old that a breath "is exactly the
  // proof" a voice is human. It is not, and the newest fakes breathe.
  const clueKeys = collectKeys(dictionaries.en)
    .filter((key) => key.startsWith("clue."))
    .concat([
      "station2.realExplanation",
      "station2.realExplanationB",
      "station2.realExplanationC",
    ]);
  assert.ok(clueKeys.length >= 9);
  for (const key of clueKeys) {
    const english = (lookup(dictionaries.en, key) ?? "").toLowerCase();
    assert.equal(
      /\bthat'?s exactly the proof\b|\bthat is the proof\b|\balways\b/.test(english),
      false,
      `${key} states a clue as a certainty: ${english}`,
    );
  }
});

test("both languages disclose that no detector is running", () => {
  for (const lang of LANGUAGES) {
    for (const key of ["station2.echoDisclosure", "station4.echoDisclosure"]) {
      const copy = lookup(dictionaries[lang], key) ?? "";
      assert.ok(copy.length > 40, `${lang}: ${key} is missing`);
    }
  }
});
