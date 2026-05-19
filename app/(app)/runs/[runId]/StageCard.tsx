"use client";

import { useState } from "react";

import type { RunRowView, StaleFlags } from "@/lib/validation/runs";

export type StageCardState =
  | "pending"
  | "running"
  | "complete"
  | "stale"
  | "error"
  | "gated";

export type StageSpec = {
  number: number;
  name: string;
  dataKey: keyof RunRowView | null;
  staleKey: keyof StaleFlags | null;
};

const STATE_STYLES: Record<
  StageCardState,
  { dot: string; label: string; labelClass: string; opacity: string }
> = {
  pending: {
    dot: "bg-white/10 text-ink-400 ring-white/10",
    label: "pending",
    labelClass: "text-ink-400",
    opacity: "opacity-50",
  },
  running: {
    dot: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
    label: "generating…",
    labelClass: "text-blue-400",
    opacity: "",
  },
  complete: {
    dot: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
    label: "complete",
    labelClass: "text-emerald-400",
    opacity: "",
  },
  stale: {
    dot: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
    label: "stale",
    labelClass: "text-amber-400",
    opacity: "",
  },
  error: {
    dot: "bg-rose-500/15 text-rose-400 ring-rose-500/30",
    label: "failed",
    labelClass: "text-rose-400",
    opacity: "",
  },
  gated: {
    dot: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
    label: "gated",
    labelClass: "text-amber-400",
    opacity: "",
  },
};

function shortJson(value: unknown, maxChars: number): string {
  try {
    const str = JSON.stringify(value, null, 2);
    return str.length > maxChars ? `${str.slice(0, maxChars)}…` : str;
  } catch {
    return String(value);
  }
}

export function StageCard({
  spec,
  run,
  cardState,
  progressMessage,
}: {
  spec: StageSpec;
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
}) {
  const styles = STATE_STYLES[cardState];
  const stageData =
    spec.dataKey !== null ? run[spec.dataKey] : null;
  const [rerunning, setRerunning] = useState(false);

  async function handleRerun() {
    if (spec.dataKey === null) return;
    setRerunning(true);
    try {
      await fetch(`/api/runs/${run.id}/rerun-from?stage=${spec.number}`, {
        method: "POST",
      });
    } finally {
      setRerunning(false);
    }
  }

  return (
    <li
      className={`card-row rounded-xl px-4 py-3 flex items-start gap-3 ${styles.opacity}`}
    >
      <span
        className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 shrink-0 ${styles.dot}`}
      >
        {cardState === "complete" ? (
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 5 5L20 7" />
          </svg>
        ) : cardState === "running" ? (
          <svg
            className="h-3.5 w-3.5 spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          spec.number
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">
            {spec.number} · {spec.name}{" "}
            <span className={`text-xs font-normal ${styles.labelClass}`}>
              · {styles.label}
            </span>
          </p>
          {(cardState === "complete" || cardState === "stale") &&
            spec.dataKey !== null && (
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunning}
                className="text-xs text-ink-400 hover:text-white disabled:opacity-50 transition"
              >
                {rerunning ? "…" : "Regenerate"}
              </button>
            )}
        </div>
        {cardState === "running" && progressMessage && (
          <p className="text-xs text-ink-400 mt-1">{progressMessage}</p>
        )}
        {(cardState === "complete" || cardState === "stale") &&
          stageData !== null && (
            <pre className="text-[11px] font-mono text-ink-400 mt-2 max-h-32 overflow-hidden bg-ink-900/60 rounded-md p-2">
              {shortJson(stageData, 240)}
            </pre>
          )}
        {cardState === "error" && run.failureReason && (
          <p className="text-xs text-rose-300/80 mt-1 font-mono">
            {run.failureReason}
          </p>
        )}
      </div>
    </li>
  );
}
