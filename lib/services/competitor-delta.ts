import "server-only";

import {
  buildSystem,
  callClaude,
  extractTextFromMessage,
} from "@/lib/anthropic";
import {
  COMPETITOR_SYSTEM,
  COMPETITOR_SYSTEM_EST_TOKENS,
  buildCompetitorUserPrompt,
  type CompetitorPromptInput,
} from "@/lib/prompts/competitor";
import {
  TriggerLabelSchema,
  type ExtractedPattern,
  type Outlier,
  type TriggerLabel,
} from "@/lib/validation/competitor";
import { UpstreamError } from "@/lib/youtube/errors";

// LLM-side delta extraction. Split out of competitor.ts to keep that file
// under Q-2's 300-line cap. The orchestrator owns the YouTube layer; this
// module owns the Anthropic round-trip (system prompt, parse, retry, merge).

export type DeltaLLMOutput = {
  outliers: Array<{
    videoId: string;
    deltaLabel: string;
    deltaReason: string;
    transferableLesson: string;
    triggerLabels: TriggerLabel[];
    deltaStatus: "complete" | "partial" | "missing";
  }>;
  extractedPatterns: Array<{
    pattern: string;
    evidence: string[];
    confidence: "low" | "medium" | "high";
    category:
      | "framing"
      | "title_structure"
      | "length"
      | "thumbnail"
      | "trigger"
      | "format";
  }>;
};

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

function normalizeLLMOutput(raw: unknown): DeltaLLMOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.outliers)) return null;

  const outliers: DeltaLLMOutput["outliers"] = [];
  for (const item of r.outliers) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.videoId !== "string") continue;
    const rawTriggers = Array.isArray(o.triggerLabels) ? o.triggerLabels : [];
    const triggerLabels: TriggerLabel[] = [];
    for (const t of rawTriggers.slice(0, 4)) {
      const parsed = TriggerLabelSchema.safeParse(t);
      if (parsed.success) triggerLabels.push(parsed.data);
    }
    const status = o.deltaStatus;
    const deltaStatus: DeltaLLMOutput["outliers"][number]["deltaStatus"] =
      status === "complete" || status === "partial" || status === "missing"
        ? status
        : "missing";
    outliers.push({
      videoId: o.videoId,
      deltaLabel:
        typeof o.deltaLabel === "string" ? o.deltaLabel.slice(0, 120) : "",
      deltaReason:
        typeof o.deltaReason === "string" ? o.deltaReason.slice(0, 800) : "",
      transferableLesson:
        typeof o.transferableLesson === "string"
          ? o.transferableLesson.slice(0, 400)
          : "",
      triggerLabels,
      deltaStatus,
    });
  }

  const extractedPatterns: DeltaLLMOutput["extractedPatterns"] = [];
  if (Array.isArray(r.extractedPatterns)) {
    for (const item of r.extractedPatterns.slice(0, 10)) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      if (typeof p.pattern !== "string" || !p.pattern) continue;
      if (!Array.isArray(p.evidence) || p.evidence.length === 0) continue;
      const evidence = (p.evidence as unknown[]).filter(
        (e): e is string => typeof e === "string" && /^[\w-]{11}$/.test(e),
      );
      if (evidence.length === 0) continue;
      const confidence = p.confidence;
      const category = p.category;
      if (
        (confidence !== "low" &&
          confidence !== "medium" &&
          confidence !== "high") ||
        (category !== "framing" &&
          category !== "title_structure" &&
          category !== "length" &&
          category !== "thumbnail" &&
          category !== "trigger" &&
          category !== "format")
      ) {
        continue;
      }
      extractedPatterns.push({
        pattern: p.pattern.slice(0, 120),
        evidence,
        confidence,
        category,
      });
    }
  }

  return { outliers, extractedPatterns };
}

// Single batched Opus 4.7 call with one re-attempt on malformed JSON (spec §5.7).
// Build the system block ONCE so the cache_control bytes are identical across
// the retry — that's what unlocks `cache_read_input_tokens > 0` on call N+1.
export async function extractDeltas(
  promptInput: CompetitorPromptInput,
): Promise<DeltaLLMOutput> {
  const userPrompt = buildCompetitorUserPrompt(promptInput);
  const system = buildSystem(COMPETITOR_SYSTEM, COMPETITOR_SYSTEM_EST_TOKENS);

  const first = await callClaude({
    stage: "competitor",
    system,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 4096,
  });
  const firstText = extractTextFromMessage(first);
  const firstNormalized = normalizeLLMOutput(safeJsonParse(firstText));
  if (firstNormalized && firstNormalized.outliers.length > 0) {
    return firstNormalized;
  }

  const retry = await callClaude({
    stage: "competitor",
    system,
    messages: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: firstText.slice(0, 4000) },
      {
        role: "user",
        content:
          "Your previous output failed validation. Return ONLY the strict JSON object from the system prompt — no preamble, no code fences, starting with '{'. Echo every input videoId exactly once.",
      },
    ],
    maxTokens: 4096,
  });
  const retryText = extractTextFromMessage(retry);
  const retryNormalized = normalizeLLMOutput(safeJsonParse(retryText));
  if (!retryNormalized) {
    throw new UpstreamError("Anthropic returned malformed JSON twice");
  }
  return retryNormalized;
}

// Server-side join: LLM output is merged into the YouTube-derived facts by
// videoId. Hallucinated IDs are dropped with a logged warning; missing IDs
// receive deltaStatus: "missing" with placeholder copy so the UI still
// renders the outlier with the "PARTIAL" badge from the mockup.
export function mergeDeltas(
  rawOutliers: Outlier[],
  llm: DeltaLLMOutput,
): { outliers: Outlier[]; patterns: ExtractedPattern[] } {
  const byId = new Map(llm.outliers.map((o) => [o.videoId, o] as const));
  const inputIds = new Set(rawOutliers.map((o) => o.videoId));

  const outliers: Outlier[] = rawOutliers.map((raw) => {
    const match = byId.get(raw.videoId);
    if (!match || match.deltaStatus === "missing") {
      return {
        ...raw,
        deltaLabel: match?.deltaLabel || "pattern not extracted",
        deltaReason:
          match?.deltaReason ||
          "Model could not extract a delta for this outlier.",
        transferableLesson: match?.transferableLesson ?? "",
        triggerLabels: match?.triggerLabels ?? [],
        deltaStatus: "missing",
      };
    }
    return {
      ...raw,
      deltaLabel: match.deltaLabel || "structural delta",
      deltaReason: match.deltaReason || "Outperformed channel baseline.",
      transferableLesson: match.transferableLesson,
      triggerLabels: match.triggerLabels,
      deltaStatus: match.deltaStatus,
    };
  });

  const patterns: ExtractedPattern[] = llm.extractedPatterns
    .map((p) => ({
      ...p,
      evidence: p.evidence.filter((id) => inputIds.has(id)),
    }))
    .filter((p) => p.evidence.length > 0);

  return { outliers, patterns };
}
