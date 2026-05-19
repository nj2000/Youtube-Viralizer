"use client";

import { useMemo } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import {
  CompetitorDataSchema,
  type CompetitorData,
} from "@/lib/validation/competitor";

import type { StageCardState } from "./StageCard";
import { EmptyCard, ErrorCard, PendingCard } from "./stage3/EmptyAndError";
import { LoadingCard } from "./stage3/LoadingCard";
import { MainCard } from "./stage3/MainCard";

export type Stage3CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
  errorCode: string | null;
};

function tryParseCompetitorData(payload: unknown): CompetitorData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = CompetitorDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function Stage3Card({
  run,
  cardState,
  progressMessage,
  errorCode,
}: Stage3CardProps) {
  const data = useMemo(
    () => tryParseCompetitorData(run.competitorData),
    [run.competitorData],
  );

  if (cardState === "running") {
    return <LoadingCard progressMessage={progressMessage} />;
  }
  if (cardState === "error") {
    return (
      <ErrorCard
        errorCode={errorCode}
        failureReason={run.failureReason}
        runId={run.id}
        priorData={data}
      />
    );
  }
  if (
    (cardState === "complete" || cardState === "stale") &&
    data &&
    data.noOutliers
  ) {
    return (
      <EmptyCard data={data} stale={cardState === "stale"} runId={run.id} />
    );
  }
  if ((cardState === "complete" || cardState === "stale") && data) {
    return (
      <MainCard data={data} stale={cardState === "stale"} runId={run.id} />
    );
  }
  return <PendingCard cardState={cardState} />;
}
