import "server-only";

import { randomUUID } from "node:crypto";

import { callClaude, extractTextFromMessage } from "@/lib/anthropic";
import {
  buildDriftUserPrompt,
  DRIFT_SYSTEM,
  DRIFT_SYSTEM_EST_TOKENS,
  type DriftPromptInput,
} from "@/lib/prompts/lint";
import { DEFAULT_SEVERITY } from "@/lib/prompts/lint-rules";
import { passesDrift } from "./lint-script";
import {
  DriftCheckSchema,
  DriftDimensionSchema,
  LintIssueSchema,
  type DriftCheck,
  type DriftDimension,
  type LintIssue,
} from "@/lib/validation/lint";
import { LintParseError, usageOf, type PassUsage } from "./lint-anti-pattern";

export type DriftResult = {
  drift: DriftCheck;
  issues: LintIssue[]; // derived drift/* issues (§5.4)
  usage: PassUsage;
};

function extractJsonObject(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (cleaned.startsWith("{")) return cleaned;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function unitOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

function strArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

// Map the raw drift object into a validated DriftCheck. `passed` is policy, not
// model judgment — we recompute it from the threshold and overwrite the model.
function coerceDrift(
  raw: Record<string, unknown>,
  input: DriftPromptInput,
  openingWordCount: number,
): DriftCheck {
  const driftScore = Math.trunc(num(raw.driftScore, 0, 100, 100));
  const passed = passesDrift(driftScore);

  const promiseRaw =
    raw.titlePromise && typeof raw.titlePromise === "object"
      ? (raw.titlePromise as Record<string, unknown>)
      : {};
  const openingRaw =
    raw.scriptOpening && typeof raw.scriptOpening === "object"
      ? (raw.scriptOpening as Record<string, unknown>)
      : {};

  const missedDimensions = (Array.isArray(raw.missedDimensions)
    ? raw.missedDimensions
    : [])
    .map((d) => DriftDimensionSchema.safeParse(d))
    .filter((p): p is { success: true; data: DriftDimension } => p.success)
    .map((p) => p.data)
    .slice(0, 5);

  const keywordFirstHit = Number.isFinite(Number(openingRaw.keywordFirstHit))
    ? Math.max(0, Math.trunc(Number(openingRaw.keywordFirstHit)))
    : null;

  const candidate = {
    driftScore,
    passed,
    semanticSimilarity: unitOrNull(raw.semanticSimilarity),
    confidence: unitOrNull(raw.confidence),
    problem: passed ? null : (typeof raw.problem === "string" ? raw.problem.slice(0, 800) : "Title promise not delivered in the first 25% of the script."),
    missedDimensions,
    titlePromise: {
      titleText:
        (typeof promiseRaw.titleText === "string" && promiseRaw.titleText.trim()
          ? promiseRaw.titleText.trim()
          : input.chosenTitle
        ).slice(0, 500),
      coreClaims: strArray(promiseRaw.coreClaims, 5, 200),
    },
    scriptOpening: {
      wordCount: openingWordCount,
      detectedTopics: strArray(openingRaw.detectedTopics, 5, 200),
      keywordFirstHit,
    },
  };

  return DriftCheckSchema.parse(candidate);
}

// §5.4: derive issues from a failed/partial drift verdict. These ride in the
// same issues[] array; drift/* issues can be dismissed but never accepted.
function deriveIssues(
  drift: DriftCheck,
  openingText: string,
  now: string,
): LintIssue[] {
  const out: LintIssue[] = [];

  if (!drift.passed) {
    const candidate = {
      id: randomUUID(),
      ruleId: "drift/title-promise-not-met-by-2min" as const,
      severity: DEFAULT_SEVERITY["drift/title-promise-not-met-by-2min"],
      sectionIndex: -1,
      lineRange: { start: 0, end: 0 },
      excerpt: (drift.problem ?? drift.titlePromise.titleText).slice(0, 500),
      message: (drift.problem ?? "Title promise not delivered in the first 2 minutes.").slice(0, 280),
      suggestedFix: null, // drift fixes require a Stage 7 re-run, not a patch
      accepted: false,
      dismissed: false,
      createdAt: now,
      updatedAt: now,
    };
    const parsed = LintIssueSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }

  const extra = drift.missedDimensions.filter(
    (d) => d !== "subject" && d !== "delivery-time",
  );
  if (extra.length > 0) {
    const excerpt = openingText.slice(0, 200) || drift.titlePromise.titleText;
    const candidate = {
      id: randomUUID(),
      ruleId: "drift/topic-shift-mid-section" as const,
      severity: DEFAULT_SEVERITY["drift/topic-shift-mid-section"],
      sectionIndex: 0,
      lineRange: { start: 0, end: Math.min(200, excerpt.length) },
      excerpt,
      message: `Opening drifts on: ${extra.join(", ")}.`.slice(0, 280),
      suggestedFix: null,
      accepted: false,
      dismissed: false,
      createdAt: now,
      updatedAt: now,
    };
    const parsed = LintIssueSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }

  return out;
}

export async function runDriftPass(
  input: DriftPromptInput,
  openingWordCount: number,
): Promise<DriftResult> {
  const now = new Date().toISOString();

  const first = await callClaude({
    stage: "lint",
    system: DRIFT_SYSTEM,
    estSystemTokens: DRIFT_SYSTEM_EST_TOKENS,
    messages: [{ role: "user", content: buildDriftUserPrompt(input) }],
    maxTokens: 1024,
  });
  let usage = usageOf(first);
  let raw = parseObject(extractTextFromMessage(first));

  if (!raw) {
    const retry = await callClaude({
      stage: "lint",
      system: DRIFT_SYSTEM,
      estSystemTokens: DRIFT_SYSTEM_EST_TOKENS,
      messages: [
        {
          role: "user",
          content: `${buildDriftUserPrompt(input)}\n\nYour previous output failed JSON parsing. Re-emit ONLY the JSON object — first character '{', no prose.`,
        },
      ],
      maxTokens: 1024,
    });
    usage = usageOf(retry);
    raw = parseObject(extractTextFromMessage(retry));
    if (!raw) throw new LintParseError();
  }

  const drift = coerceDrift(raw, input, openingWordCount);
  return { drift, issues: deriveIssues(drift, input.scriptOpening, now), usage };
}
