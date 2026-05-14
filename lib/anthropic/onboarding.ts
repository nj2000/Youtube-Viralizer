import type Anthropic from "@anthropic-ai/sdk";

import { anthropic } from "./client";
import { buildSystem } from "./cache";
import { MODELS } from "./models";
import { withRetry } from "./retry";

// Onboarding lives outside the pipeline DAG, so it does NOT route through
// `callClaude(stage)` — that mapping is reserved for the 10 production
// stages. CLAUDE.md CRIT-2 lists Sonnet 4.6 as the onboarding model.
export type CallSonnetInput = {
  system: string | Anthropic.TextBlockParam[];
  estSystemTokens?: number;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
};

export async function callSonnet(
  input: CallSonnetInput,
): Promise<Anthropic.Message> {
  const system = Array.isArray(input.system)
    ? input.system
    : buildSystem(input.system, input.estSystemTokens ?? 0);

  return withRetry(() =>
    anthropic.messages.create({
      model: MODELS.sonnet,
      max_tokens: input.maxTokens,
      system,
      messages: input.messages,
    }),
  );
}

export function extractTextFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
