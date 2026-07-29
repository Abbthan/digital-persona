// Lightweight, deterministic profanity filter for public/community content,
// persona names, and 1:1 persona chat. This deliberately does not make a
// behavioural or context-based judgement: it masks a small list of clearly
// inappropriate terms — plus their common evasions — before data is
// persisted. A fuller moderation service can replace this later without
// changing callers.
//
// Entries are regex source, not literal strings: a `(?:...)` group spells
// out a common alternate/shortened form (e.g. "nigga" alongside "nigger").
// Matching is plain substring (no word boundaries) so joining a blocked term
// onto adjacent text without a space ("fuckyou") still gets caught — the
// tradeoff is that a handful of legitimate words that happen to contain one
// as a substring (e.g. "Scunthorpe") would also get masked. Given this is a
// casual chat surface rather than encyclopedic text, catching evasions is
// the safer default here.
const BLOCKED_TERMS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "nigg(?:er|a|az|as|ers)",
  "fag(?:got|s)?",
  "retard",
  "porn",
  "dick",
  "pussy",
  "cock",
  "操",
  "妈的",
  "他妈的",
  "傻逼",
  "傻屌",
  "鸡巴",
  "色情",
  "裸聊",
  "性奴",
];

const BLOCKED_PATTERN = new RegExp(
  BLOCKED_TERMS.sort((first, second) => second.length - first.length).join("|"),
  "giu",
);

// Visually-similar character substitutions ("sh1t", "@sshole", "b1tch") —
// each maps to exactly one replacement character so the normalized string
// stays the same length and index-aligned with the original, letting matches
// found here be masked directly against the original text's positions.
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
  "8": "b",
};
const LEET_PATTERN = /[01!|34@5$7+8]/g;

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(LEET_PATTERN, (char) => LEET_MAP[char] ?? char);
}

/** Replaces every offending word or character with same-length asterisks. */
export function maskInappropriateLanguage(text: string): string {
  const normalized = normalizeForMatch(text);
  let result = "";
  let cursor = 0;
  for (const match of normalized.matchAll(BLOCKED_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start < cursor) continue;
    result += text.slice(cursor, start) + "*".repeat(end - start);
    cursor = end;
  }
  return result + text.slice(cursor);
}

export function isFlagged(text: string): boolean {
  return maskInappropriateLanguage(text) !== text;
}
