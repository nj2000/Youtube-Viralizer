// Baseline CTR for the A/B plan (spec §5.2). Channel CTR isn't directly stored,
// so we derive a plausible baseline from channel scale and clamp it to a sane
// band; brand-new channels (no history) use the niche average. Basis points.

const MIN_BP = 100; // 1%
const MAX_BP = 3000; // 30%
export const NICHE_AVERAGE_FALLBACK_BP = 620; // 6.2% for new channels

export type BaselineResult = {
  baselineCtrBp: number;
  baselineSource: "channel_actual" | "niche_average_fallback";
};

function clampBp(bp: number): number {
  return Math.max(MIN_BP, Math.min(MAX_BP, Math.round(bp)));
}

// Heuristic: anchor on the niche average, nudged by channel scale (a healthy
// median-views-to-subscriber ratio correlates with stronger packaging). This is
// a stand-in until Feature #17 calibrates against real post-publish CTRs.
export function computeBaselineCtr(channel: {
  subscriberCount: number | null;
  medianViews: number | null;
}): BaselineResult {
  const subs = channel.subscriberCount ?? 0;
  const median = channel.medianViews ?? 0;
  if (subs <= 0 || median <= 0) {
    return { baselineCtrBp: NICHE_AVERAGE_FALLBACK_BP, baselineSource: "niche_average_fallback" };
  }
  // viewsPerSub in [0,1+]; scale ±200bp around the niche average.
  const viewsPerSub = Math.min(1, median / subs);
  const baselineCtrBp = clampBp(NICHE_AVERAGE_FALLBACK_BP - 100 + viewsPerSub * 300);
  return { baselineCtrBp, baselineSource: "channel_actual" };
}
