import type {
  RehookBeat,
  RetentionSample,
  ScriptSection,
} from "@/lib/validation/script";

// Deterministic retention heuristic (Phase 1 — Feature #15 replaces this with
// a trained model). Samples roughly every 30s: exponential baseline decay
// (first 30s free for the cold open) plus rehook/loop bonuses and
// demo-density / rehook-gap penalties. Pure + unit-tested.

const SAMPLE_STRIDE_SEC = 30;
const DECAY_HALFLIFE_DENOM = 360; // ~6-min half-life shape
const MAX_DECAY = 40;

function sectionAt(sections: ScriptSection[], t: number): ScriptSection | null {
  return sections.find((s) => t >= s.startSec && t < s.endSec) ?? null;
}

export function predictRetentionCurve(args: {
  sections: ScriptSection[];
  rehookBeats: RehookBeat[];
  openLoopCount: number;
  estimatedRuntimeSec: number;
}): RetentionSample[] {
  const { sections, rehookBeats, estimatedRuntimeSec } = args;
  const totalSec = Math.max(estimatedRuntimeSec, SAMPLE_STRIDE_SEC);
  const rehookTimes = rehookBeats.map((r) => r.atSec).sort((a, b) => a - b);

  const samples: RetentionSample[] = [];
  for (let t = 0; t <= totalSec; t += SAMPLE_STRIDE_SEC) {
    let predicted = 100;
    let riskFlag: RetentionSample["riskFlag"] = "none";

    if (t > 30) {
      const elapsed = t - 30;
      predicted -= Math.round(
        MAX_DECAY * (1 - Math.exp(-elapsed / DECAY_HALFLIFE_DENOM)),
      );
    }

    const nearestRehook = rehookTimes.length
      ? Math.min(...rehookTimes.map((r) => Math.abs(r - t)))
      : Infinity;
    if (nearestRehook <= 10) predicted += 6;

    const section = sectionAt(sections, t);
    if (section?.role === "demonstration") {
      const demoElapsed = t - section.startSec;
      if (demoElapsed > 180) {
        predicted -= 5;
        riskFlag = "demo_density";
      }
    }
    if (section?.role === "payoff" && t - section.startSec < SAMPLE_STRIDE_SEC) {
      predicted -= 2;
      if (riskFlag === "none") riskFlag = "topic_pivot";
    }

    const lastRehookBefore = rehookTimes.filter((r) => r <= t).at(-1) ?? 0;
    if (t > 90 && t - lastRehookBefore > 120) {
      predicted -= 3;
      if (riskFlag === "none") riskFlag = "rehook_gap";
    }

    predicted = Math.max(0, Math.min(100, predicted));
    samples.push({ timeSec: t, predicted, riskFlag });
  }
  return samples;
}

// Mean predicted retention across the samples that fall inside a section.
export function sectionRetention(
  curve: RetentionSample[],
  startSec: number,
  endSec: number,
): number {
  const inRange = curve.filter((s) => s.timeSec >= startSec && s.timeSec < endSec);
  if (inRange.length === 0) {
    // Fall back to the nearest sample at/under startSec.
    const before = curve.filter((s) => s.timeSec <= startSec).at(-1);
    return before?.predicted ?? 100;
  }
  const sum = inRange.reduce((acc, s) => acc + s.predicted, 0);
  return Math.round(sum / inRange.length);
}
