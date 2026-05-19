"use client";

import type { CompetitorData } from "@/lib/validation/competitor";

import { MainCardBody } from "./MainCard";
import { RegenerateButton } from "./RegenerateDialog";
import { StageHeader } from "./shared";
import type { StageCardState } from "../StageCard";

export function EmptyCard({
  data,
  stale,
  runId,
}: {
  data: CompetitorData;
  stale: boolean;
  runId: string;
}) {
  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill={stale ? "Stage 3 · Stale" : "Stage 3 · No results"}
        pillClass="bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
        subtitle={`Searched ${data.diagnostics.competitorsScanned} competitor channels · 30-day window · no videos crossed 5× their channel median`}
      />
      <div className="mt-4 rounded-xl bg-white/[0.02] ring-1 ring-white/5 p-6 text-center">
        <p className="text-sm font-semibold text-white">
          No outliers in your niche this month
        </p>
        <p className="text-xs text-ink-400 mt-2 max-w-md mx-auto">
          Your competitor set hasn&apos;t published 5×+ videos in the last 30
          days. The niche is in a quiet stretch — try again in a few days, or
          expand your competitor list.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <RegenerateButton runId={runId} cached={null} />
          <button
            type="button"
            disabled
            title="Coming soon — Phase 2 will let you lower the 5× threshold"
            className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 text-ink-500 cursor-not-allowed"
          >
            Lower threshold to 3×
          </button>
        </div>
      </div>
    </li>
  );
}

export function ErrorCard({
  errorCode,
  failureReason,
  runId,
  priorData,
}: {
  errorCode: string | null;
  failureReason: string | null;
  runId: string;
  priorData: CompetitorData | null;
}) {
  const isQuota =
    errorCode === "QUOTA_EXCEEDED" ||
    (failureReason ?? "").toLowerCase().includes("soft cap");
  const isNoCompetitors = errorCode === "NO_COMPETITORS";
  const title = isQuota
    ? "Daily YouTube quota nearly exhausted"
    : isNoCompetitors
      ? "Add competitors before running this stage"
      : "Stage 3 failed";
  const body = isQuota
    ? "We use the YouTube Data API to find outliers and today's 10,000-unit budget is at the 8,000-unit soft cap. New outlier searches resume at midnight Pacific."
    : isNoCompetitors
      ? "This channel has no competitors set. Visit onboarding to add up to 8."
      : (failureReason ?? "Unexpected error. Try regenerating.");

  return (
    <li className="card rounded-2xl p-5 border border-rose-500/25">
      <StageHeader
        pill="Stage 3 · Error"
        pillClass="bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30"
        subtitle={isQuota ? "Pipeline halted" : title}
      />
      <div className="mt-4 rounded-xl bg-rose-500/[0.06] ring-1 ring-rose-500/15 p-4">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-ink-300 mt-1">{body}</p>
        <div className="mt-3 flex gap-2 flex-wrap">
          {priorData && !priorData.noOutliers && (
            <span className="text-xs px-2.5 py-1 rounded-md bg-white/5 text-ink-300 ring-1 ring-white/10">
              {priorData.outliers.length} cached outliers available below
            </span>
          )}
          <button
            type="button"
            disabled
            title="Phase 2 — auto-resume at quota reset"
            className="text-xs px-2.5 py-1 rounded-md ring-1 ring-white/10 bg-white/5 text-ink-500 cursor-not-allowed"
          >
            Queue for midnight (coming soon)
          </button>
          {!isQuota && <RegenerateButton runId={runId} cached={null} />}
        </div>
      </div>
      {priorData && !priorData.noOutliers && (
        <div className="mt-4">
          <MainCardBody data={priorData} stale />
        </div>
      )}
    </li>
  );
}

export function PendingCard({ cardState }: { cardState: StageCardState }) {
  const isGated = cardState === "gated";
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        3
      </span>
      <p className="text-sm font-semibold text-white">
        3 · Competitor outliers
        <span className="text-xs font-normal text-ink-400 ml-1">
          · {isGated ? "blocked by gate" : "pending"}
        </span>
      </p>
    </li>
  );
}
