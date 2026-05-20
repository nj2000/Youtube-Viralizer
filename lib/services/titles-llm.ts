import "server-only";

import {
  callClaude,
  extractTextFromMessage,
  type CallClaudeInput,
} from "@/lib/anthropic";
import {
  buildIntentRewritePrompt,
  buildTitleUserPrompt,
  type IntentRewritePromptInput,
  type TitlePromptInput,
} from "@/lib/prompts/titles";
import {
  JACCARD_DIVERSITY_THRESHOLD,
  TITLE_CHAR_HARD_LIMIT,
  type TitleTrigger,
} from "@/lib/validation/titles";

// LLM-side title generation. Split out of titles.ts to keep that file under
// Q-2's 300-line cap. Each call reuses the prebuilt system block so calls
// 2/3/4 hit the ephemeral cache (CRIT-3).

export class CharLimitViolationError extends Error {
  constructor(readonly trigger: TitleTrigger) {
    super(`Title for ${trigger} exceeded ${TITLE_CHAR_HARD_LIMIT} chars twice`);
    this.name = "CharLimitViolationError";
  }
}

export type RawTitle = {
  text: string;
  predictedCtrLift: number;
  audienceCluster: string;
  voiceMatch: { score: number; label: "strong" | "moderate" | "weak" | "fallback" };
  reasoning: string;
  truncated: boolean;
  originalLength: number | null;
};

type SystemBlock = CallClaudeInput["system"];

function safeJsonParse(text: string): unknown | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function clampLabel(
  raw: unknown,
  voiceFallback: boolean,
): "strong" | "moderate" | "weak" | "fallback" {
  if (voiceFallback) return "fallback";
  if (raw === "strong" || raw === "moderate" || raw === "weak") return raw;
  return "weak";
}

function coerceRawTitle(
  raw: unknown,
  voiceFallback: boolean,
): { text: string; fields: Omit<RawTitle, "text" | "truncated" | "originalLength"> } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string" || r.text.trim().length === 0) return null;
  const vm =
    r.voiceMatch && typeof r.voiceMatch === "object"
      ? (r.voiceMatch as Record<string, unknown>)
      : {};
  const score = voiceFallback
    ? 0
    : typeof vm.score === "number"
      ? Math.max(0, Math.min(10, Math.round(vm.score)))
      : 0;
  return {
    text: r.text.trim(),
    fields: {
      predictedCtrLift:
        typeof r.predictedCtrLift === "number"
          ? Math.max(-50, Math.min(200, r.predictedCtrLift))
          : 0,
      audienceCluster:
        typeof r.audienceCluster === "string" && r.audienceCluster.trim()
          ? r.audienceCluster.slice(0, 80)
          : "general audience",
      voiceMatch: { score, label: clampLabel(vm.label, voiceFallback) },
      reasoning:
        typeof r.reasoning === "string" && r.reasoning.trim()
          ? r.reasoning.slice(0, 800)
          : "Generated for the requested trigger.",
    },
  };
}

async function callOnce(
  system: SystemBlock,
  input: TitlePromptInput,
  voiceFallback: boolean,
): Promise<{ text: string; fields: Omit<RawTitle, "text" | "truncated" | "originalLength"> } | null> {
  const msg = await callClaude({
    stage: "titles",
    system,
    messages: [{ role: "user", content: buildTitleUserPrompt(input) }],
    maxTokens: 512,
  });
  return coerceRawTitle(safeJsonParse(extractTextFromMessage(msg)), voiceFallback);
}

// One trigger: call, and if >100 chars re-prompt exactly once. A second
// over-limit response throws CharLimitViolationError (task.md verification).
export async function generateOneTitle(
  system: SystemBlock,
  input: TitlePromptInput,
  voiceFallback: boolean,
): Promise<RawTitle> {
  const first = await callOnce(system, input, voiceFallback);
  if (!first) throw new Error(`titles: empty model output for ${input.trigger}`);
  if (first.text.length <= TITLE_CHAR_HARD_LIMIT) {
    return { text: first.text, truncated: false, originalLength: null, ...first.fields };
  }

  const originalLength = first.text.length;
  const second = await callOnce(
    system,
    { ...input, charRetryFrom: originalLength },
    voiceFallback,
  );
  if (!second || second.text.length > TITLE_CHAR_HARD_LIMIT) {
    throw new CharLimitViolationError(input.trigger);
  }
  return { text: second.text, truncated: true, originalLength, ...second.fields };
}

// --- Jaccard diversity ---

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/^\s*(i|my|how|the)\s+/, "")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

export function maxPairwiseJaccard(texts: string[]): number {
  let max = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      max = Math.max(max, jaccard(texts[i]!, texts[j]!));
    }
  }
  return max;
}

export function isTooSimilar(texts: string[]): boolean {
  return maxPairwiseJaccard(texts) >= JACCARD_DIVERSITY_THRESHOLD;
}

// --- Intent rewrites (4th call, cached system) ---

export async function generateIntentRewrites(
  system: SystemBlock,
  input: IntentRewritePromptInput,
): Promise<string[]> {
  const msg = await callClaude({
    stage: "titles",
    system,
    messages: [{ role: "user", content: buildIntentRewritePrompt(input) }],
    maxTokens: 512,
  });
  const parsed = safeJsonParse(extractTextFromMessage(msg));
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as Record<string, unknown>).intentRewrites;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is string => typeof s === "string" && s.trim().length >= 1)
    .map((s) => s.slice(0, 200))
    .slice(0, 5);
}
