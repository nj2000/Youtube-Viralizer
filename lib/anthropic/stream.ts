import type Anthropic from "@anthropic-ai/sdk";

import { anthropic } from "./client";
import { buildSystem } from "./cache";
import { modelFamily, stageModel, type Stage } from "./models";

// True token streaming for Stage 7 (retention script). Unlike `callClaude`
// (non-streaming `messages.create`), this uses `messages.stream()` and invokes
// `onTextDelta` for each text chunk so the route can forward SSE section_chunk
// events live. Returns the final assembled Message (incl. usage for budget
// tracking). The SDK import is allowed here — this file lives in lib/anthropic/**.

export type CallClaudeStreamInput = {
  stage: Stage;
  system: string | Anthropic.TextBlockParam[];
  estSystemTokens?: number;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  onTextDelta?: (delta: string) => void;
};

export async function callClaudeStream(
  input: CallClaudeStreamInput,
): Promise<Anthropic.Message> {
  const model = stageModel[input.stage];
  const family = modelFamily(model);

  const system = Array.isArray(input.system)
    ? input.system
    : buildSystem(input.system, input.estSystemTokens ?? 0);

  const params: Anthropic.Messages.MessageCreateParamsStreaming = {
    model,
    max_tokens: input.maxTokens,
    system,
    messages: input.messages,
    stream: true,
  };

  if (family === "opus") {
    params.thinking = { type: "adaptive" };
    params.output_config = { effort: "high" };
  }

  const stream = anthropic.messages.stream(params);
  if (input.onTextDelta) {
    stream.on("text", (delta: string) => input.onTextDelta!(delta));
  }
  return stream.finalMessage();
}

// Per-million-token USD prices (locked here so budget math has one source).
const PRICE_PER_MTOK: Record<
  "opus" | "sonnet" | "haiku",
  { input: number; output: number }
> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};

// Estimate the USD cost of a completed call from its usage block. Cache reads
// are billed at input rate here (a slight over-estimate that errs toward the
// budget cap — acceptable for a soft guard).
export function estimateCostMicroUsd(
  stage: Stage,
  usage: Anthropic.Usage | null | undefined,
): number {
  if (!usage) return 0;
  const family = modelFamily(stageModel[stage]);
  const price = PRICE_PER_MTOK[family];
  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;
  const usd =
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;
  return Math.round(usd * 1_000_000);
}
