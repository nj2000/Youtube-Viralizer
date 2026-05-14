import type { Competitor } from "@/lib/validation/channels";

const MAX_COMPETITORS = 20;

export function mergeCompetitors(
  existing: Competitor[],
  incoming: Competitor[],
): Competitor[] {
  const incomingIds = new Set(incoming.map((c) => c.youtubeChannelId));
  const preservedManual = existing
    .filter((c) => c.source === "manual")
    .filter((c) => !incomingIds.has(c.youtubeChannelId));
  return [...incoming, ...preservedManual].slice(0, MAX_COMPETITORS);
}
