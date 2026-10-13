export type SiteContent = {
  version: 1;
  text: Record<string, { en: string; zh: string }>;
};

export function parseSiteContent(value: unknown): SiteContent {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("text" in value) ||
    !value.text ||
    typeof value.text !== "object" ||
    Array.isArray(value.text)
  ) {
    throw new Error("Expected a version 1 website text dictionary.");
  }
  const entries = Object.entries(value.text);
  if (entries.length > 1000) throw new Error("Too many text overrides.");
  const text: SiteContent["text"] = Object.create(null);
  for (const [source, item] of entries) {
    if (
      !source.trim() ||
      !item ||
      typeof item !== "object" ||
      !("en" in item) ||
      !("zh" in item) ||
      typeof item.en !== "string" ||
      typeof item.zh !== "string" ||
      Math.max(source.length, item.en.length, item.zh.length) > 20000
    )
      throw new Error("Each entry needs English and Chinese text.");
    text[source] = { en: item.en, zh: item.zh };
  }
  return { version: 1, text };
}

export function websiteText(
  value: string,
  locale: "en" | "zh",
  content: SiteContent,
  fallback: (text: string) => string,
): string {
  const core = value.trim();
  if (!core) return value;
  if (!Object.hasOwn(content.text, core))
    return locale === "zh" ? fallback(value) : value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  return leading + content.text[core][locale] + trailing;
}
