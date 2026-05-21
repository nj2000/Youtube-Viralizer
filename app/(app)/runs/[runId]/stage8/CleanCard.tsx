"use client";

import { useState } from "react";

import { LINT_THRESHOLDS } from "@/lib/prompts/lint-rules";
import type { LintData } from "@/lib/validation/lint";
import { useLint } from "@/lib/hooks/useLint";

import { Stage8Header, scannedSubtitle } from "./shared";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-lg px-3 py-3 ring-1 ${tone}`}>
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-2xl font-extrabold font-mono mt-1">{value}</p>
    </div>
  );
}

function deliveredAt(data: LintData): string | null {
  const hit = data.drift.scriptOpening.keywordFirstHit;
  if (hit === null) return null;
  const sec = Math.round((hit / LINT_THRESHOLDS.WPM) * 60);
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
}

// State 2 — clean. Zero non-dismissed issues and drift passed.
export function CleanCard({ data, runId }: { data: LintData; runId: string }) {
  const lint = useLint(runId);
  const [rerunning, setRerunning] = useState(false);
  const time = deliveredAt(data);

  return (
    <li className="card rounded-2xl p-5">
      <Stage8Header
        pill="Passed"
        pillClass="bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25"
        subtitle={scannedSubtitle(data.scanWordCount, data.scanDurationMs)}
        right={
          <button
            type="button"
            disabled={rerunning}
            onClick={async () => {
              setRerunning(true);
              try {
                await lint.rerun(true);
              } finally {
                setRerunning(false);
              }
            }}
            className="text-xs text-ink-400 hover:text-white disabled:opacity-50 transition"
          >
            {rerunning ? "…" : "Re-run lint"}
          </button>
        }
      />

      <div className="mt-5 flex flex-col items-center text-center py-4">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-2 ring-emerald-500/30">
          <svg
            className="h-8 w-8 text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 5 5L20 7" />
          </svg>
        </span>
        <h3 className="text-xl font-extrabold text-white tracking-tight mt-3">
          Clean. Script passes all checks.
        </h3>
        <p className="text-xs text-ink-400 mt-1 max-w-md">
          No filler intros, no AI tells, no drift. Title promise lands inside the
          first 90 seconds.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Issues" value={0} tone="bg-white/[0.03] ring-white/5" />
        <Stat label="Critical" value={0} tone="bg-rose-500/5 ring-rose-500/10" />
        <Stat label="Warnings" value={0} tone="bg-amber-500/5 ring-amber-500/10" />
        <Stat label="Info" value={0} tone="bg-blue-500/5 ring-blue-500/10" />
      </div>

      <div className="mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 bg-emerald-500/10 ring-1 ring-emerald-500/25 text-xs text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Drift check: passed
        {time && (
          <span className="text-ink-400">· Title promise delivered at {time}</span>
        )}
      </div>

      <p className="mt-4 text-xs text-ink-400 flex items-center gap-1.5">
        <svg
          className="h-3.5 w-3.5 text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <path d="m5 12 5 5L20 7" />
        </svg>
        Would block publish? <span className="font-semibold text-white">No</span>
      </p>
    </li>
  );
}
