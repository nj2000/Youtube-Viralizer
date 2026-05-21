// Forbidden-phrase scan for engagement copy — the same anti-patterns Stage 8
// flags in scripts (hostage engagement, generic CTAs, AI tells). Pure, so it's
// unit-testable and reused by the engagement lint-retry loop.

export const FORBIDDEN_PHRASES = [
  "smash that like",
  "smash the like",
  "like and subscribe",
  "don't forget to subscribe",
  "dont forget to subscribe",
  "hit the bell",
  "thanks for watching",
  "if you enjoyed this video",
  "welcome back",
  "hey guys",
  "delve into",
  "it is important to note",
] as const;

// Returns the forbidden phrases found in the text (case-insensitive). Empty
// array = clean.
export function scanForbidden(text: string): string[] {
  const haystack = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((p) => haystack.includes(p));
}

export function isClean(text: string): boolean {
  return scanForbidden(text).length === 0;
}

// All engagement artifact text concatenated, for a single pass.
export function scanDrafts(parts: string[]): string[] {
  return [...new Set(parts.flatMap(scanForbidden))];
}
