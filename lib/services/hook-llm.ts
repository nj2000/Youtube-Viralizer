import "server-only";

import {
  callClaude,
  extractTextFromMessage,
  type CallClaudeInput,
} from "@/lib/anthropic";
import { buildHookUserPrompt, type HookPromptInput } from "@/lib/prompts/hook";
import {
  HookArchetypeSchema,
  HookBeatSchema,
  type HookArchetype,
  type HookBeat,
} from "@/lib/validation/hook";

// LLM round-trip for hook generation: one Haiku call returning all three
// variants, with a single re-prompt if the linkedTitleIndex values don't form
// the set {0,1,2}.

export class InvalidHookError extends Error {
  constructor(message = "hook model returned unparseable output twice") {
    super(message);
    this.name = "InvalidHookError";
  }
}

export type RawHookVariant = {
  linkedTitleIndex: 0 | 1 | 2;
  archetype: HookArchetype;
  promise: string;
  beats: HookBeat[];
  reasoning: string;
  openerStrengthRaw: number;
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

function coerceVariant(raw: unknown): RawHookVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const idx = r.linkedTitleIndex;
  if (idx !== 0 && idx !== 1 && idx !== 2) return null;

  const archetype = HookArchetypeSchema.safeParse(r.archetype);
  if (!archetype.success) return null;

  if (typeof r.promise !== "string" || r.promise.trim().length < 10) return null;

  if (!Array.isArray(r.beats)) return null;
  const beats: HookBeat[] = [];
  for (const b of r.beats) {
    const parsed = HookBeatSchema.safeParse(b);
    if (parsed.success) beats.push(parsed.data);
  }
  if (beats.length < 2) return null;

  return {
    linkedTitleIndex: idx,
    archetype: archetype.data,
    promise: r.promise.slice(0, 200),
    beats: beats.slice(0, 8),
    reasoning:
      typeof r.reasoning === "string" && r.reasoning.trim()
        ? r.reasoning.slice(0, 400)
        : "Opens with tension that delivers on the linked title.",
    openerStrengthRaw:
      typeof r.openerStrengthRaw === "number"
        ? Math.max(0, Math.min(100, Math.round(r.openerStrengthRaw)))
        : 60,
  };
}

function parseVariants(text: string): RawHookVariant[] | null {
  const parsed = safeJsonParse(text);
  if (!parsed || typeof parsed !== "object") return null;
  const arr = (parsed as Record<string, unknown>).variants;
  if (!Array.isArray(arr)) return null;
  const out: RawHookVariant[] = [];
  for (const v of arr) {
    const c = coerceVariant(v);
    if (c) out.push(c);
  }
  return out.length === 3 ? out : null;
}

function formsIndexSet(variants: RawHookVariant[]): boolean {
  const set = new Set(variants.map((v) => v.linkedTitleIndex));
  return set.size === 3;
}

async function callOnce(
  system: SystemBlock,
  input: HookPromptInput,
): Promise<RawHookVariant[] | null> {
  const msg = await callClaude({
    stage: "hook",
    system,
    messages: [{ role: "user", content: buildHookUserPrompt(input) }],
    maxTokens: 2200,
  });
  return parseVariants(extractTextFromMessage(msg));
}

// Returns the three raw variants plus whether set-equality had to be forced
// (caller flags ARCHETYPE_DUPLICATE warnings when true).
export async function generateHookVariants(
  system: SystemBlock,
  input: HookPromptInput,
): Promise<{ variants: RawHookVariant[]; setEqualityForced: boolean }> {
  const first = await callOnce(system, input);
  if (first && formsIndexSet(first)) {
    return { variants: first, setEqualityForced: false };
  }

  // One re-prompt with the stricter set-equality reminder.
  const second = await callOnce(system, { ...input, setEqualityRetry: true });
  if (!second) {
    if (first) {
      // Model produced 3 variants but with duplicate indices both times —
      // reassign indices 0/1/2 by position and flag.
      return { variants: forceDistinctIndices(first), setEqualityForced: true };
    }
    throw new InvalidHookError();
  }
  if (formsIndexSet(second)) {
    return { variants: second, setEqualityForced: false };
  }
  return { variants: forceDistinctIndices(second), setEqualityForced: true };
}

function forceDistinctIndices(variants: RawHookVariant[]): RawHookVariant[] {
  return variants.map((v, i) => ({
    ...v,
    linkedTitleIndex: i as 0 | 1 | 2,
  }));
}
