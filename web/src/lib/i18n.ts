import en from "@/i18n/en.json";
import nl from "@/i18n/nl.json";

import {
  translate,
  type Dictionaries,
  type Language,
} from "@/lib/i18n-core";

export type { Language } from "@/lib/i18n-core";
export { DEFAULT_LANGUAGE, LANGUAGES } from "@/lib/i18n-core";

/** The only place the two dictionaries are bound to the translator. */
export const DICTIONARIES: Dictionaries = { nl, en };

export function t(
  key: string,
  lang: Language = "nl",
  vars?: Record<string, string | number>,
): string {
  return translate(DICTIONARIES, lang, key, vars);
}
