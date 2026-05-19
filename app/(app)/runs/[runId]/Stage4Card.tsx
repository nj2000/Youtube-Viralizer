"use client";

import { useMemo } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { ScoreDataSchema, type ScoreData } from "@/lib/validation/score";

import type { StageCardState } from "./StageCard";
import { FailedCard } from "./stage4/FailedCard";
import { PassedCard } from "./stage4/PassedCard";
import { ScoringCard } from "./stage4/ScoringCard";

export type Stage4CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
};

function tryParseScoreData(payload: unknown): ScoreData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = ScoreDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function Stage4Card({
  run,
  cardState,
  progressMessage,
}: Stage4CardProps) {
  const data = useMemo(
    () => tryParseScoreData(run.scoreData),
    [run.scoreData],
  );

  if (cardState === "running") {
    return <ScoringCard progressMessage={progressMessage} />;
  }
  // Gate failure: render failed card whenever score_data is present and
  // gate hasn't been overridden. Run status may be 'gated_failed' (active
  // gate) or anything later if the score is stale after a downstream re-run.
  if (data && !data.passed && run.gateOverriddenAt === null) {
    return <FailedCard data={data} ideaText={run.ideaText} runId={run.id} />;
  }
  if (data) {
    // Passed naturally OR via override — both render via PassedCard which
    // checks `gateOverriddenAt` to switch its visual tone.
    return (
      <PassedCard
        data={{ ...data, gateOverriddenAt: run.gateOverriddenAt ?? data.gateOverriddenAt }}
        stale={cardState === "stale"}
        runId={run.id}
      />
    );
  }
  // Pending / blocked-by-upstream — fall back to a tiny placeholder row.
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        4
      </span>
      <p className="text-sm font-semibold text-white">
        4 · Idea score
        <span className="text-xs font-normal text-ink-400 ml-1">
          {cardState === "gated"
            ? "· blocked by gate"
            : cardState === "error"
              ? "· failed"
              : "· pending"}
        </span>
      </p>
    </li>
  );
}
