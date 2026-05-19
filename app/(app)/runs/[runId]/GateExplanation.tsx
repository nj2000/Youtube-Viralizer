"use client";

import { useState } from "react";
import Link from "next/link";

export function GateExplanation({
  runId,
  score,
}: {
  runId: string;
  score: number;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleRerunFromGate() {
    setSubmitting(true);
    try {
      await fetch(`/api/runs/${runId}/rerun-from?stage=4`, { method: "POST" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-xl p-5 mb-6"
      style={{
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.25)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="h-8 w-8 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </span>
        <div className="flex-1">
          <h2 className="text-base font-extrabold text-amber-200">
            This idea didn&apos;t clear the 92% gate (scored {score})
          </h2>
          <p className="text-sm text-amber-300/80 mt-1">
            Stages 5–12 were skipped. Sharpen the angle and re-run, or drop a
            different idea.
          </p>
          <p className="text-xs text-amber-300/60 mt-3 uppercase tracking-wider font-semibold">
            Reframe suggestions
          </p>
          <p className="text-xs text-amber-300/70 mt-1">
            Phase 2 stage 4 will surface 3 LLM-generated reframes here. For now,
            edit your idea and try again.
          </p>
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={handleRerunFromGate}
              disabled={submitting}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Re-running…" : "Re-run from gate"}
            </button>
            <Link
              href="/runs/new"
              className="px-4 py-2 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white font-semibold rounded-lg text-sm transition"
            >
              Edit my own idea
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
