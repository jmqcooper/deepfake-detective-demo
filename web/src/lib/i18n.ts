import en from "@/i18n/en.json";
import nl from "@/i18n/nl.json";

export type Language = "nl" | "en";

const translations: Record<Language, unknown> = { nl, en };

export function t(key: string, lang: Language = "nl"): string {
  let value: unknown = translations[lang];

  for (const segment of key.split(".")) {
    if (typeof value !== "object" || value === null || !(segment in value)) {
      return key;
    }
    value = (value as Record<string, unknown>)[segment];
  }

  return typeof value === "string" ? value : key;
}
