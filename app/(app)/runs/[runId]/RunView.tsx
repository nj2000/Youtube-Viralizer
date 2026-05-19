"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useRun } from "@/lib/hooks/useRun";
import type { RunRowView, StaleFlags } from "@/lib/validation/runs";

import { StageCard, type StageCardState, type StageSpec } from "./StageCard";
import { Stage3Card } from "./Stage3Card";
import { GateExplanation } from "./GateExplanation";
import { StaleBanner } from "./StaleBanner";

const STAGE_SPECS: StageSpec[] = [
  { number: 1, name: "Channel context", dataKey: null, staleKey: null },
  { number: 2, name: "Idea normalize", dataKey: null, staleKey: null },
  { number: 3, name: "Competitor outliers", dataKey: "competitorData", staleKey: "competitor" },
  { number: 4, name: "Idea score", dataKey: "scoreData", staleKey: "score" },
  { number: 5, name: "Titles", dataKey: "titlesData", staleKey: "titles" },
  { number: 6, name: "Cold-open hook", dataKey: "hookData", staleKey: "hook" },
  { number: 7, name: "Retention script", dataKey: "scriptData", staleKey: "script" },
  { number: 8, name: "Anti-pattern lint", dataKey: "lintData", staleKey: "lint" },
  { number: 9, name: "Thumbnail briefs", dataKey: "thumbnailsData", staleKey: "thumbnails" },
  { number: 10, name: "SEO metadata", dataKey: "seoData", staleKey: "seo" },
  { number: 11, name: "A/B test plan", dataKey: "abPlanData", staleKey: "abPlan" },
  { number: 12, name: "Pinned/community", dataKey: "engagementDraftsData", staleKey: "engagementDrafts" },
];

function stageStateFor(
  spec: StageSpec,
  run: RunRowView,
  currentLiveStage: number | null,
  runState: "loading" | "live" | "terminal" | "error",
): StageCardState {
  // Stages 1-2 are synthesized: complete the moment the run exists.
  if (spec.dataKey === null) return "complete";

  const isStale =
    spec.staleKey !== null && run.stale[spec.staleKey as keyof StaleFlags];
  const hasOutput = run[spec.dataKey] !== null;

  if (run.status === "gated_failed" && spec.number === 4) return "gated";
  if (run.status === "gated_failed" && spec.number > 4 && !hasOutput) {
    return "pending";
  }

  if (run.status === "error" && spec.number === run.currentStage) {
    return "error";
  }

  if (
    runState === "live" &&
    currentLiveStage === spec.number &&
    !hasOutput
  ) {
    return "running";
  }

  if (hasOutput) return isStale ? "stale" : "complete";
  return "pending";
}

function progressPercent(run: RunRowView): number {
  const total = 10;
  let completed = 0;
  if (run.competitorData) completed++;
  if (run.scoreData) completed++;
  if (run.titlesData) completed++;
  if (run.hookData) completed++;
  if (run.scriptData) completed++;
  if (run.lintData) completed++;
  if (run.thumbnailsData) completed++;
  if (run.seoData) completed++;
  if (run.abPlanData) completed++;
  if (run.engagementDraftsData) completed++;
  return Math.round((completed / total) * 100);
}

export function RunView({ initialRun }: { initialRun: RunRowView }) {
  const { run, progress, state, error } = useRun(initialRun.id);
  const display = run ?? initialRun;

  const currentLiveStage = progress?.stage ?? display.currentStage ?? null;
  const percent = progressPercent(display);
  const hasStale = useMemo(() => {
    return Object.values(display.stale).some(Boolean);
  }, [display.stale]);

  const scoreValue =
    display.scoreData &&
    typeof (display.scoreData as { score?: unknown }).score === "number"
      ? (display.scoreData as { score: number }).score
      : null;

  return (
    <div>
      <nav className="text-xs text-ink-400 mb-3">
        <Link href="/runs" className="hover:text-ink-200 transition">
          Runs
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-300 font-mono">{display.id.slice(0, 8)}</span>
      </nav>
      <h1 className="text-2xl font-extrabold tracking-tight text-white">
        {display.ideaText}
      </h1>
      <div className="flex items-center justify-between mt-3 mb-6">
        <p className="text-xs text-ink-400">
          {display.status === "queued" && "Queued — orchestrator starting"}
          {display.status === "running" &&
            currentLiveStage !== null &&
            `Running · stage ${currentLiveStage} / 12`}
          {display.status === "complete" && "Complete · 12 / 12"}
          {display.status === "gated_failed" &&
            `Gated · score ${scoreValue ?? "—"} / 100`}
          {display.status === "error" && "Stalled — see stage card below"}
        </p>
        <StatusPill run={display} currentLiveStage={currentLiveStage} />
      </div>

      <div className="mb-6">
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-yt-600 to-yt-500 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-xs text-ink-400 mt-2">
          {percent}% complete · {state === "live" ? "streaming live" : state}
        </p>
      </div>

      {hasStale && <StaleBanner />}

      {display.status === "gated_failed" && scoreValue !== null && (
        <GateExplanation runId={display.id} score={scoreValue} />
      )}

      <ul className="space-y-2 mt-6">
        {STAGE_SPECS.map((spec) => {
          const cardState = stageStateFor(
            spec,
            display,
            currentLiveStage,
            state,
          );
          const progressMessage =
            progress && progress.stage === spec.number ? progress.message : null;
          if (spec.number === 3) {
            return (
              <Stage3Card
                key={spec.number}
                run={display}
                cardState={cardState}
                progressMessage={progressMessage}
                errorCode={error?.code ?? null}
              />
            );
          }
          return (
            <StageCard
              key={spec.number}
              spec={spec}
              run={display}
              cardState={cardState}
              progressMessage={progressMessage}
            />
          );
        })}
      </ul>
    </div>
  );
}

function StatusPill({
  run,
  currentLiveStage,
}: {
  run: RunRowView;
  currentLiveStage: number | null;
}) {
  switch (run.status) {
    case "queued":
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 text-ink-300 text-[11px] font-bold uppercase tracking-wider ring-1 ring-white/10">
          Queued
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-[11px] font-bold uppercase tracking-wider ring-1 ring-blue-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 pulse-dot" />
          Running · stage {currentLiveStage ?? "?"} / 12
        </span>
      );
    case "complete":
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yt-600/15 text-yt-400 text-[11px] font-bold uppercase tracking-wider ring-1 ring-yt-600/30">
          Complete · 12 / 12
        </span>
      );
    case "gated_failed":
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-[11px] font-bold uppercase tracking-wider ring-1 ring-amber-500/20">
          Gated
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 text-[11px] font-bold uppercase tracking-wider ring-1 ring-rose-500/20">
          Error · stage {run.currentStage ?? "?"}
        </span>
      );
  }
}
