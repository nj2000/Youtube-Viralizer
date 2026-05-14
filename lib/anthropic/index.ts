import type Anthropic from "@anthropic-ai/sdk";

import { anthropic } from "./client";
import { buildSystem } from "./cache";
import { modelFamily, stageModel, type Stage } from "./models";
import { withRetry } from "./retry";

export { MODELS, modelFamily, stageModel } from "./models";
export type { Model, ModelFamily, Stage } from "./models";
export { buildSystem, MIN_CACHEABLE_TOKENS } from "./cache";
export { withRetry } from "./retry";
export { callSonnet, extractTextFromMessage } from "./onboarding";
export type { CallSonnetInput } from "./onboarding";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type CallClaudeInput = {
  stage: Stage;
  system: string | Anthropic.TextBlockParam[];
  estSystemTokens?: number;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  thinking?: Anthropic.ThinkingConfigParam;
  effort?: Effort;
};

export async function callClaude(
  input: CallClaudeInput,
): Promise<Anthropic.Message> {
  const model = stageModel[input.stage];
  const family = modelFamily(model);

  const system = Array.isArray(input.system)
    ? input.system
    : buildSystem(input.system, input.estSystemTokens ?? 0);

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: input.maxTokens,
    system,
    messages: input.messages,
  };

  // Opus 4.7 defaults: adaptive thinking + high effort, per the Anthropic
  // skill ("a minimum of high for most intelligence-sensitive work").
  if (family === "opus") {
    params.thinking = input.thinking ?? { type: "adaptive" };
    params.output_config = { effort: input.effort ?? "high" };
  } else if (family === "sonnet") {
    if (input.thinking) params.thinking = input.thinking;
    if (input.effort) params.output_config = { effort: input.effort };
  }
  // Haiku 4.5 rejects `thinking` and `effort` with a 400 — silently drop.

  return withRetry(() => anthropic.messages.create(params));
}
