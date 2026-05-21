import "server-only";

import { randomUUID } from "node:crypto";

import {
  callClaude,
  extractTextFromMessage,
  type CallClaudeInput,
} from "@/lib/anthropic";
import {
  buildLintUserPrompt,
  LINT_SYSTEM,
  LINT_SYSTEM_EST_TOKENS,
  type LintPromptInput,
} from "@/lib/prompts/lint";
import { DEFAULT_SEVERITY, RULE_SPECS } from "@/lib/prompts/lint-rules";
import {
  LintIssueSchema,
  LintRuleIdSchema,
  isDriftRule,
  type LintIssue,
  type LintRuleId,
} from "@/lib/validation/lint";

export class LintParseError extends Error {
  constructor(message = "lint model returned unparseable output twice") {
    super(message);
    this.name = "LintParseError";
  }
}

export type PassUsage = {
  promptTokens: number;
  outputTokens: number;
  cacheHit: boolean;
};

export type AntiPatternResult = {
  issues: LintIssue[];
  usage: PassUsage;
};

const GLOBAL_RULES: ReadonlySet<LintRuleId> = new Set(
  RULE_SPECS.filter((r) => r.scope === "global").map((r) => r.id),
);

const RULE_DESCRIPTION: Record<LintRuleId, string> = Object.freeze(
  RULE_SPECS.reduce(
    (acc, r) => {
      acc[r.id] = r.description;
      return acc;
    },
    {} as Record<LintRuleId, string>,
  ),
);

function extractJsonArray(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (cleaned.startsWith("[")) return cleaned;
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

function parseIssueArray(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(extractJsonArray(text));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clampStr(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.slice(0, max) : null;
}

// Coerce one raw model object into a server-stamped LintIssue, applying scope
// and severity policy. Returns null when the row can't be salvaged.
function coerceIssue(raw: unknown, now: string): LintIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const ruleParsed = LintRuleIdSchema.safeParse(r.ruleId);
  if (!ruleParsed.success) return null;
  const ruleId = ruleParsed.data;
  // Drift issues are produced only by the drift pass — defensively drop any the
  // anti-pattern model emits.
  if (isDriftRule(ruleId)) return null;

  const isGlobal = GLOBAL_RULES.has(ruleId);
  const sectionIndex = isGlobal
    ? -1
    : Math.max(0, Math.trunc(Number(r.sectionIndex) || 0));

  let start = 0;
  let end = 0;
  if (!isGlobal && r.lineRange && typeof r.lineRange === "object") {
    const lr = r.lineRange as Record<string, unknown>;
    start = Math.max(0, Math.trunc(Number(lr.start) || 0));
    end = Math.max(start, Math.trunc(Number(lr.end) || start));
  }

  const excerpt =
    clampStr(r.excerpt, 500) ??
    clampStr(r.message, 500) ??
    RULE_DESCRIPTION[ruleId];
  const message = clampStr(r.message, 280) ?? RULE_DESCRIPTION[ruleId];
  const suggestedFix = clampStr(r.suggestedFix, 2000); // null when absent/blank

  const candidate = {
    id: randomUUID(),
    ruleId,
    severity: DEFAULT_SEVERITY[ruleId], // policy override — model can't promote/demote
    sectionIndex,
    lineRange: { start, end },
    excerpt,
    message,
    suggestedFix,
    accepted: false,
    dismissed: false,
    createdAt: now,
    updatedAt: now,
  };

  const parsed = LintIssueSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// tone/voice-mismatch is only valid with ≥10 top-video titles (spec §5.1);
// strip it when the channel context can't support it.
export function dropVoiceMismatch(
  issues: LintIssue[],
  voiceAvailable: boolean,
): LintIssue[] {
  return voiceAvailable
    ? issues
    : issues.filter((i) => i.ruleId !== "tone/voice-mismatch");
}

// Dedup to one issue per (ruleId, sectionIndex); the model is told to emit the
// most severe / earliest first, so first-wins is correct.
function dedup(issues: LintIssue[]): LintIssue[] {
  const seen = new Set<string>();
  const out: LintIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.ruleId}::${issue.sectionIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function usageOf(msg: Awaited<ReturnType<typeof callClaude>>): PassUsage {
  const u = msg.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return {
    promptTokens: u.input_tokens + cacheRead + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens,
    cacheHit: cacheRead > 0,
  };
}

async function callOnce(
  input: LintPromptInput,
  corrective: string | null,
): Promise<{ text: string; usage: PassUsage }> {
  const userContent = corrective
    ? `${buildLintUserPrompt(input)}\n\n${corrective}`
    : buildLintUserPrompt(input);
  const params: CallClaudeInput = {
    stage: "lint",
    system: LINT_SYSTEM,
    estSystemTokens: LINT_SYSTEM_EST_TOKENS,
    messages: [{ role: "user", content: userContent }],
    maxTokens: 4096,
  };
  const msg = await callClaude(params);
  return { text: extractTextFromMessage(msg), usage: usageOf(msg) };
}

export async function runAntiPatternPass(
  input: LintPromptInput,
): Promise<AntiPatternResult> {
  const now = new Date().toISOString();

  let { text, usage } = await callOnce(input, null);
  let rawArray = parseIssueArray(text);

  if (!rawArray) {
    // One reformat retry with a corrective instruction (spec §5.3).
    ({ text, usage } = await callOnce(
      input,
      "Your previous output failed JSON parsing. Re-emit ONLY a valid JSON array of issue objects — first character '[', no prose.",
    ));
    rawArray = parseIssueArray(text);
    if (!rawArray) throw new LintParseError();
  }

  const coerced = rawArray
    .map((raw) => coerceIssue(raw, now))
    .filter((i): i is LintIssue => i !== null);
  const issues = dropVoiceMismatch(coerced, input.voiceAvailable);

  return { issues: dedup(issues).slice(0, 200), usage };
}
