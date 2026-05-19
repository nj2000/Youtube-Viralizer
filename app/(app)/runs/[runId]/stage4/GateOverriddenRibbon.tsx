"use client";

import { useState } from "react";

export function GateOverriddenRibbon({
  runId,
  reason,
  finalScore,
}: {
  runId: string;
  reason: string | null;
  finalScore: number | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  async function reverse() {
    setSubmitting(true);
    try {
      await fetch(`/api/runs/${runId}/override-gate`, { method: "DELETE" });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section
      className="rounded-xl px-5 py-4 mb-6 flex items-start gap-3"
      style={{
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.25)",
      }}
    >
      <span className="h-7 w-7 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
        !
      </span>
      <div className="flex-1">
        <p className="text-sm font-extrabold text-amber-200">
          Gate overridden — downstream stages may produce weaker output
        </p>
        <p className="text-xs text-amber-300/80 mt-1">
          This run scored {finalScore !== null ? Math.round(finalScore) : "—"}
          /100 but you chose to continue. Titles, hooks, and scripts will run
          anyway.
          {reason ? ` Reason: ${reason}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={reverse}
        disabled={submitting}
        className="text-xs px-3 py-1.5 rounded-md ring-1 ring-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 transition disabled:opacity-60"
      >
        {submitting ? "Reversing…" : "Reverse override"}
      </button>
    </section>
  );
}
