export const SUPPORTED_LOCALES = ["en", "zh"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LanguagePreference = SupportedLocale | "system";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === "en" || value === "zh";
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isSupportedLocale(value);
}

export function localeFromSystemLanguage(language: string | undefined): SupportedLocale {
  return language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
