/**
 * The translator, with no dictionaries baked in.
 *
 * There used to be two of these — one in `lib/i18n.ts` and one inside the
 * kiosk hooks — with different fallback behaviour, which is how a missing key
 * could render as English in one place and as `station3.tryAll` in another.
 * Keeping the dictionaries out of this module also means the rules can be
 * tested without importing JSON through a bundler.
 */

export type Language = "nl" | "en";

export const LANGUAGES: readonly Language[] = ["nl", "en"];

/** Dutch is the default; English is the fallback; the key itself is the floor. */
export const DEFAULT_LANGUAGE: Language = "nl";
export const FALLBACK_LANGUAGE: Language = "en";

export type Dictionaries = Record<Language, unknown>;

export function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  // An unknown placeholder is left verbatim rather than rendered as "undefined":
  // a visible `{pct}` is a bug report, a silent "undefined%" is a shipped one.
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(
  dicts: Dictionaries,
  lang: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw =
    lookup(dicts[lang], key) ?? lookup(dicts[FALLBACK_LANGUAGE], key) ?? key;
  return interpolate(raw, vars);
}

/** Every leaf key in a dictionary, dotted. Used to compare the two languages. */
export function collectKeys(dict: unknown, prefix = ""): string[] {
  if (typeof dict !== "object" || dict === null) return [];
  return Object.entries(dict as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : collectKeys(value, path);
  });
}

/** Placeholders a string expects, e.g. `["pct"]` for "{pct}% were fooled". */
export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}
