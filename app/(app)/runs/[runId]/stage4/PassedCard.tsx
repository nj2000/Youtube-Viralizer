"use client";

import { useState } from "react";

import type { ScoreData } from "@/lib/validation/score";

import { DimensionBars, StageHeader } from "./shared";

export function PassedCard({
  data,
  stale,
  runId,
}: {
  data: ScoreData;
  stale: boolean;
  runId: string;
}) {
  const [rerunning, setRerunning] = useState(false);
  const wasOverridden = data.gateOverriddenAt !== null;

  async function rerunScore() {
    setRerunning(true);
    try {
      await fetch("/api/pipeline/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    } finally {
      setRerunning(false);
    }
  }

  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill={
          wasOverridden
            ? "Stage 4 · Overridden"
            : stale
              ? "Stage 4 · Stale"
              : "Stage 4 · Passed gate"
        }
        pillClass={
          wasOverridden
            ? "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30"
            : stale
              ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
              : "bg-result-500/10 text-result-500 ring-1 ring-result-500/30"
        }
        subtitle={
          wasOverridden
            ? `Gate overridden — original score ${data.finalScore}/100`
            : "Greenlight — pipeline continues to titles, hook, script"
        }
        right={
          <button
            type="button"
            onClick={rerunScore}
            disabled={rerunning}
            className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white transition disabled:opacity-60"
          >
            {rerunning ? "…" : "Re-score"}
          </button>
        }
      />
      <div className="mt-5 flex items-baseline gap-2">
        <span
          className={`text-5xl font-extrabold tracking-tight ${wasOverridden ? "text-amber-300" : "text-result-500"}`}
          style={{
            textShadow: wasOverridden
              ? "0 0 24px rgba(245,158,11,0.35)"
              : "0 0 24px rgba(16,185,129,0.35)",
          }}
        >
          {Math.round(data.finalScore)}
        </span>
        <span className="text-sm text-ink-400">/ 100 · gate 92</span>
      </div>
      <DimensionBars dimensions={data.dimensions} tone="pass" />
      {data.reasoning && (
        <p className="mt-4 text-xs text-ink-300 leading-relaxed">
          {data.reasoning}
        </p>
      )}
      {data.lowConfidence && (
        <p className="mt-3 text-[11px] text-amber-300/80">
          Low confidence — fewer than 10 outlier patterns informed this score.
        </p>
      )}
    </li>
  );
}
