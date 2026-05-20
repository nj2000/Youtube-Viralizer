"use client";

import { useState } from "react";

import type { ScriptData } from "@/lib/validation/script";
import { DRIFT_PASS_THRESHOLD } from "@/lib/validation/script";

import { RetentionCurve, SectionBody, StageHeader, mmss } from "./shared";

export function ScriptView({
  data,
  stale,
  runId,
}: {
  data: ScriptData;
  stale: boolean;
  runId: string;
}) {
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [relocking, setRelocking] = useState(false);
  const driftFlagged = data.drift.score > DRIFT_PASS_THRESHOLD;

  async function regenerateSection(sectionIndex: number) {
    setBusyIndex(sectionIndex);
    try {
      await fetch("/api/pipeline/script/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, sectionIndex }),
      });
    } finally {
      setBusyIndex(null);
    }
  }

  async function relock() {
    setRelocking(true);
    try {
      await fetch("/api/pipeline/script/relock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    } finally {
      setRelocking(false);
    }
  }

  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill={stale ? "Stage 7 · Stale" : "Stage 7 · Complete"}
        pillClass={
          stale
            ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
            : "bg-result-500/10 text-result-500 ring-1 ring-result-500/30"
        }
        subtitle={`${data.targetMinutes}-min · ${data.totalWordCount} words · ${mmss(data.estimatedRuntimeSec)} runtime`}
        right={
          <div className="flex gap-2">
            <a
              href={`/api/pipeline/script/plain-text?runId=${runId}`}
              className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white transition"
            >
              Plain text
            </a>
            <button
              type="button"
              onClick={relock}
              disabled={relocking}
              className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white transition disabled:opacity-60"
            >
              {relocking ? "…" : "Re-pick"}
            </button>
          </div>
        }
      />

      {driftFlagged && (
        <div className="mt-3 rounded-md bg-amber-500/[0.06] ring-1 ring-amber-500/20 p-3 text-[11px] text-amber-200">
          Drift detected (score {data.drift.score}/100).{" "}
          {data.drift.problemDescription ??
            "The title promise may land late. Non-blocking — you can continue, regenerate, or re-pick the title."}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            Predicted retention · heuristic (LLM-only)
          </p>
        </div>
        <RetentionCurve curve={data.retentionCurve} />
      </div>

      <div className="mt-4 space-y-4">
        {data.sections.map((section) => (
          <div key={section.index} className="rounded-lg ring-1 ring-white/5 p-4 bg-white/[0.02]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-white">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-yt-600/10 text-yt-400 ring-1 ring-yt-600/20 mr-2">
                  {mmss(section.startSec)}
                </span>
                {section.title}
                <span className="ml-2 text-[10px] font-normal text-ink-400">
                  retention ~{section.predictedRetention}
                </span>
              </p>
              <button
                type="button"
                disabled={busyIndex !== null}
                onClick={() => regenerateSection(section.index)}
                className="text-[11px] px-2 py-1 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-60"
              >
                {busyIndex === section.index ? "…" : "Regenerate"}
              </button>
            </div>
            <div className="mt-3">
              <SectionBody section={section} />
            </div>
            {section.retentionRehook && (
              <p className="mt-2 text-[11px] text-curiosity-500">
                ↻ rehook: {section.retentionRehook}
              </p>
            )}
          </div>
        ))}
      </div>

      {data.openLoops.length > 0 && (
        <p className="mt-4 text-[11px] text-ink-400">
          {data.openLoops.length} open loop{data.openLoops.length === 1 ? "" : "s"}{" "}
          · {data.rehookBeats.length} rehook beat
          {data.rehookBeats.length === 1 ? "" : "s"}
        </p>
      )}
    </li>
  );
}
