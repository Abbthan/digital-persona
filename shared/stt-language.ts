export const STT_LANGUAGE_PREFERENCES = ["mandarin", "wu", "english"] as const;

export type SttLanguagePreference = (typeof STT_LANGUAGE_PREFERENCES)[number];

export function isSttLanguagePreference(value: unknown): value is SttLanguagePreference {
  return typeof value === "string" && STT_LANGUAGE_PREFERENCES.includes(value as SttLanguagePreference);
}

export function normalizeSttLanguagePreference(value: unknown): SttLanguagePreference {
  return isSttLanguagePreference(value) ? value : "mandarin";
}
