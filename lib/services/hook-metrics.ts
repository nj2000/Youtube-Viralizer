import {
  HOOK_WORD_TARGET,
  RETENTION_LOW_RISK_MIN,
  RETENTION_MEDIUM_RISK_MIN,
  SPEAK_WPM,
  type DropoffRisk,
  type HookArchetype,
  type HookBeat,
  type HookWarning,
} from "@/lib/validation/hook";

// Pure, deterministic metric computation for hook variants. The model never
// supplies these — the service computes them from beats + the model's
// openerStrengthRaw self-grade. Split into its own module so the formulas are
// unit-testable without touching the Anthropic client.

const ARCHETYPE_PRIOR: Record<HookArchetype, number> = {
  shock: 6,
  story: 5,
  "curiosity-gap": 2,
  "social-proof": 0,
  "problem-agitation": -2,
};

// Concrete claim: a dollar amount, percentage, an explicit duration, or a
// named tool. Rewards specificity in the promise.
const CONCRETE_ANCHOR_REGEX =
  /\$\s?\d|\d+\s?%|\b\d+\s?(?:days?|hours?|hrs?|minutes?|mins?|weeks?|months?|years?)\b|\b(?:claude|chatgpt|gpt-?\d*|gemini|notion|figma|excel|python)\b/i;

// Setup-transition: signals the hook hands off cleanly into the body.
const SETUP_TRANSITION_REGEX =
  /\b(?:here'?s exactly|by the end of (?:this|the) video|let me (?:show|walk)|in (?:the )?next \d+|so here'?s what|that'?s why)\b/i;

// AI/cliché openers that bleed retention. Each hit costs the variant.
const ANTI_PATTERN_REGEXES: RegExp[] = [
  /\bhey\s+(?:guys|everyone|y'?all|friends)\b/i,
  /\bwhat'?s\s+up\b/i,
  /\bwelcome\s+back\b/i,
  /\bbefore\s+(?:we|i)\s+(?:get|dive|jump)\s+in(?:to)?\b/i,
  /\b(?:smash|hit)\s+(?:that\s+)?(?:like|subscribe)\b/i,
  /\bdon'?t\s+forget\s+to\s+(?:like|subscribe)\b/i,
  /\bin\s+(?:today'?s|this)\s+video\b/i,
  /\byou\s+won'?t\s+believe\b/i,
  /\b(?:buckle|strap)\s+(?:up|in)\b/i,
];

function spokenLines(beats: HookBeat[]): string[] {
  return beats
    .map((b) => b.line)
    .filter((l): l is string => typeof l === "string" && l.length > 0);
}

export function computeWordCount(beats: HookBeat[]): number {
  return spokenLines(beats).reduce(
    (sum, line) => sum + line.split(/\s+/).filter(Boolean).length,
    0,
  );
}

export function computeSpeakTimeSec(wordCount: number): number {
  return Math.ceil((wordCount / SPEAK_WPM) * 60);
}

function lastBeatTimeSec(beats: HookBeat[]): number {
  return beats.reduce((max, b) => Math.max(max, b.timeSec), 0);
}

function countAntiPatternHits(beats: HookBeat[]): number {
  const text = spokenLines(beats).join(" ");
  return ANTI_PATTERN_REGEXES.reduce(
    (hits, re) => hits + (re.test(text) ? 1 : 0),
    0,
  );
}

export function computeRetention30s(args: {
  archetype: HookArchetype;
  openerStrengthRaw: number;
  wordCount: number;
  promise: string;
  beats: HookBeat[];
}): number {
  let score = 70;
  score += ARCHETYPE_PRIOR[args.archetype];

  // Opener self-grade contributes ±10 around the 50 midpoint.
  score += Math.max(-10, Math.min(10, (args.openerStrengthRaw - 50) / 5));

  // Word-count penalty: 0 at/under target, up to -8 as it overshoots by 45.
  if (args.wordCount > HOOK_WORD_TARGET) {
    score -= Math.min(8, ((args.wordCount - HOOK_WORD_TARGET) / 45) * 8);
  }

  if (CONCRETE_ANCHOR_REGEX.test(args.promise)) score += 5;

  const antiHits = countAntiPatternHits(args.beats);
  if (antiHits > 0) score -= Math.min(15, antiHits * 5);

  const lastLine = spokenLines(args.beats).at(-1) ?? "";
  if (SETUP_TRANSITION_REGEX.test(lastLine)) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeWarnings(args: {
  wordCount: number;
  beats: HookBeat[];
  promise: string;
}): HookWarning[] {
  const warnings: HookWarning[] = [];
  if (args.wordCount > HOOK_WORD_TARGET) warnings.push("OVER_WORD_LIMIT");
  if (lastBeatTimeSec(args.beats) > 30) warnings.push("OVER_TIME_BUDGET");
  if (!CONCRETE_ANCHOR_REGEX.test(args.promise)) {
    warnings.push("NO_CONCRETE_PROMISE");
  }
  if (countAntiPatternHits(args.beats) > 0) {
    warnings.push("ANTI_PATTERN_DETECTED");
  }
  return warnings;
}

// "Killer combination" override: over the word limit AND no concrete promise
// forces high risk regardless of the heuristic score (spec §5.6).
export function computeDropoffRisk(
  retention30sPredict: number,
  warnings: HookWarning[],
): { risk: DropoffRisk; killerCombo: boolean } {
  const killerCombo =
    warnings.includes("OVER_WORD_LIMIT") &&
    warnings.includes("NO_CONCRETE_PROMISE");
  if (killerCombo) return { risk: "high", killerCombo: true };
  if (retention30sPredict >= RETENTION_LOW_RISK_MIN) {
    return { risk: "low", killerCombo: false };
  }
  if (retention30sPredict >= RETENTION_MEDIUM_RISK_MIN) {
    return { risk: "medium", killerCombo: false };
  }
  return { risk: "high", killerCombo: false };
}
