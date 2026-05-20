"use client";

import { useMemo, useState } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { HookDataSchema, type HookData } from "@/lib/validation/hook";

import type { StageCardState } from "./StageCard";
import { GeneratingCard } from "./stage6/GeneratingCard";
import { HookCard } from "./stage6/HookCard";
import { StageHeader } from "./stage6/shared";

export type Stage6CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
};

function tryParse(payload: unknown): HookData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = HookDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function Stage6Card({
  run,
  cardState,
  progressMessage,
}: Stage6CardProps) {
  const data = useMemo(() => tryParse(run.hookData), [run.hookData]);

  if (cardState === "running") {
    return <GeneratingCard progressMessage={progressMessage} />;
  }
  if (data) {
    return <HookView data={data} stale={cardState === "stale"} runId={run.id} />;
  }
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        6
      </span>
      <p className="text-sm font-semibold text-white">
        6 · Cold-open hook
        <span className="text-xs font-normal text-ink-400 ml-1">
          {cardState === "error" ? "· failed" : "· pending"}
        </span>
      </p>
    </li>
  );
}

function HookView({
  data,
  stale,
  runId,
}: {
  data: HookData;
  stale: boolean;
  runId: string;
}) {
  const locked = data.lockedVariantIndex !== null;
  const [continuing, setContinuing] = useState(false);

  async function onContinue() {
    setContinuing(true);
    try {
      await fetch(`/api/runs/${runId}/continue`, { method: "POST" });
    } finally {
      setContinuing(false);
    }
  }

  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill={
          locked
            ? "Stage 6 · Locked"
            : stale
              ? "Stage 6 · Stale"
              : "Stage 6 · Ready"
        }
        pillClass={
          locked
            ? "bg-result-500/10 text-result-500 ring-1 ring-result-500/30"
            : stale
              ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
              : "bg-yt-600/15 text-yt-400 ring-1 ring-yt-600/30"
        }
        subtitle="Three cold opens — lock one; it becomes your script's first section."
      />

      {data.allHighRisk && (
        <div className="mt-3 rounded-md bg-amber-500/[0.06] ring-1 ring-amber-500/20 p-3 text-[11px] text-amber-200">
          All three hooks rated high-risk — this idea may be hard to open. You
          can lock one anyway, regenerate, or rethink the angle upstream.
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {data.variants.map((v, i) => (
          <HookCard
            key={i}
            runId={runId}
            variant={v}
            index={i as 0 | 1 | 2}
            locked={data.lockedVariantIndex === i}
          />
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400">
          {locked
            ? "Hook locked — ready to continue."
            : "Lock one hook to continue to the script."}
        </p>
        <button
          type="button"
          disabled={!locked || continuing}
          onClick={onContinue}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continuing ? "Starting…" : "Continue to script →"}
        </button>
      </div>
    </li>
  );
}
