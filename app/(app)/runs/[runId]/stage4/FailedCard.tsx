"use client";

import { useState } from "react";

import type { Reframe, ScoreData } from "@/lib/validation/score";

import { OverrideConfirmModal, ReframeConfirmModal } from "./ConfirmModals";
import { DimensionBars, StageHeader } from "./shared";

export function FailedCard({
  data,
  ideaText,
  runId,
}: {
  data: ScoreData;
  ideaText: string;
  runId: string;
}) {
  const reframes = data.reframes ?? [];
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  return (
    <li className="card rounded-2xl p-5 border border-amber-500/25">
      <StageHeader
        pill="Stage 4 · Gate failed"
        pillClass="bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
        subtitle="Pipeline halted — pick a reframe or override the gate"
      />
      <div className="mt-5 flex items-baseline gap-2">
        <span
          className="text-5xl font-extrabold tracking-tight text-amber-300"
          style={{ textShadow: "0 0 24px rgba(251,191,36,0.35)" }}
        >
          {Math.round(data.finalScore)}
        </span>
        <span className="text-sm text-ink-400">/ 100 · gate 92</span>
      </div>
      <DimensionBars dimensions={data.dimensions} tone="fail" />
      {data.reasoning && (
        <p className="mt-4 text-xs text-ink-300 leading-relaxed">
          {data.reasoning}
        </p>
      )}
      {data.lowConfidence && (
        <p className="mt-3 text-[11px] text-amber-300/80">
          Low confidence — fewer than 10 outlier patterns informed this score.
          The score may be noisy.
        </p>
      )}

      {reframes.length > 0 ? (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400">
            Try a refined idea · {reframes.length} reframe
            {reframes.length === 1 ? "" : "s"} predicted ≥ 92
            {data.reframeShortfall && (
              <span className="ml-2 text-amber-300/80 normal-case font-normal">
                · model returned fewer than 3
              </span>
            )}
          </p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            {reframes.map((r, i) => (
              <ReframeCard
                key={i}
                reframe={r}
                onPick={() => setConfirmIndex(i)}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-5 text-xs text-amber-300/80">
          We couldn&apos;t generate reframes — edit your idea and re-score, or
          override the gate.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowOverride(true)}
          className="text-xs px-3 py-1.5 rounded-md ring-1 ring-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 text-amber-300 transition"
        >
          Override gate and continue
        </button>
      </div>

      {confirmIndex !== null && reframes[confirmIndex] && (
        <ReframeConfirmModal
          runId={runId}
          reframeIndex={confirmIndex}
          reframe={reframes[confirmIndex]!}
          ideaText={ideaText}
          onClose={() => setConfirmIndex(null)}
        />
      )}
      {showOverride && (
        <OverrideConfirmModal
          runId={runId}
          finalScore={data.finalScore}
          onClose={() => setShowOverride(false)}
        />
      )}
    </li>
  );
}

function ReframeCard({
  reframe,
  onPick,
}: {
  reframe: Reframe;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="card-row text-left rounded-lg p-3 hover:ring-1 hover:ring-result-500/40 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-result-500/15 text-result-500">
          {reframe.expectedScoreLift}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ink-400">
          predicted
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-white leading-snug">
        {reframe.revisedIdeaText}
      </p>
      <p className="mt-2 text-[11px] text-ink-400 line-clamp-3">
        {reframe.hypothesis}
      </p>
    </button>
  );
}
