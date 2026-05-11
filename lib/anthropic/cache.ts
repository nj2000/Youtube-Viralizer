import type Anthropic from "@anthropic-ai/sdk";

// CRIT-3 threshold. Note: Opus 4.7's effective cacheable floor is ~4096
// tokens; the cache_control marker is harmless below that but won't actually
// produce a cache hit. We still apply at 1024 to satisfy CRIT-3 and to cache
// on Sonnet/Haiku, whose floors are lower (1024–2048).
export const MIN_CACHEABLE_TOKENS = 1024;

export function buildSystem(
  prompt: string,
  estTokens: number,
): Anthropic.TextBlockParam[] {
  if (estTokens >= MIN_CACHEABLE_TOKENS) {
    return [
      {
        type: "text",
        text: prompt,
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  return [{ type: "text", text: prompt }];
}
