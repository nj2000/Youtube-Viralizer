"use client";

import Link from "next/link";
import { useState } from "react";

import type { DriftCheck } from "@/lib/validation/lint";
import { useLint } from "@/lib/hooks/useLint";

// State 4 — drift detected. Side-by-side promise vs. delivered opening, plus
// the three resolutions (re-run Stage 7 / re-pick title / override).
export function DriftBanner({
  runId,
  drift,
}: {
  runId: string;
  drift: DriftCheck;
}) {
  const lint = useLint(runId);
  const [overriding, setOverriding] = useState(false);

  return (
    <div className="mt-4 rounded-xl ring-1 ring-rose-500/20 bg-rose-500/[0.06] p-4">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400 pulse-dot" />
        <h3 className="text-sm font-bold text-rose-100">Topic shift detected</h3>
        <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300">
          drift/topic-shift
        </code>
      </div>
      <p className="text-[13px] text-rose-200/85 mt-2 leading-relaxed">
        {drift.problem ??
          "The title's promise isn't delivered in the first 25% of the script."}
      </p>
      <p className="text-[11px] font-mono text-rose-300/70 mt-2">
        drift score: {drift.driftScore} / 100
        {drift.confidence !== null && ` · confidence: ${drift.confidence.toFixed(2)}`}
        {drift.semanticSimilarity !== null &&
          ` · similarity: ${drift.semanticSimilarity.toFixed(2)}`}
      </p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg ring-1 ring-white/5 bg-ink-900/60 p-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            Original promise
          </p>
          <p className="text-[13px] text-ink-100 mt-1">
            {drift.titlePromise.titleText}
          </p>
          {drift.titlePromise.coreClaims.length > 0 && (
            <ul className="mt-2 space-y-1">
              {drift.titlePromise.coreClaims.map((c, i) => (
                <li key={i} className="text-[12px] text-ink-300 flex gap-1.5">
                  <span className="text-emerald-400">•</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg ring-1 ring-rose-500/20 bg-rose-500/[0.04] p-3">
          <p className="text-[10px] uppercase tracking-wider text-rose-200/80">
            First 0:00–2:00
          </p>
          {drift.scriptOpening.detectedTopics.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {drift.scriptOpening.detectedTopics.map((t, i) => (
                <li key={i} className="text-[12px] text-rose-200/80 flex gap-1.5">
                  <span className="text-rose-400">✕</span>
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-rose-200/70 mt-2">
              Opening topics don&apos;t match the title promise.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <Link
          href={`/runs/${runId}?focus=script`}
          className="rounded-lg px-3 py-3 text-left ring-1 ring-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 transition"
        >
          <p className="text-sm font-semibold text-emerald-200">
            Rewrite first 2 min
          </p>
          <p className="text-[11px] text-ink-400 mt-1">
            Re-run Stage 7 to deliver the promise within 90s.
          </p>
          <span className="text-[10px] font-mono text-emerald-300/70">
            recommended
          </span>
        </Link>
        <Link
          href={`/runs/${runId}?focus=titles`}
          className="rounded-lg px-3 py-3 text-left ring-1 ring-white/10 bg-white/[0.025] hover:bg-white/[0.045] transition"
        >
          <p className="text-sm font-semibold text-white">Re-pick title</p>
          <p className="text-[11px] text-ink-400 mt-1">
            Choose a Stage 5 title that matches the script.
          </p>
        </Link>
        <button
          type="button"
          disabled={overriding}
          onClick={async () => {
            setOverriding(true);
            try {
              await lint.override();
            } finally {
              setOverriding(false);
            }
          }}
          className="rounded-lg px-3 py-3 text-left ring-1 ring-white/10 bg-white/[0.025] hover:bg-white/[0.045] transition disabled:opacity-50"
        >
          <p className="text-sm font-semibold text-white">
            {overriding ? "Overriding…" : "Override & continue"}
          </p>
          <p className="text-[11px] text-ink-400 mt-1">
            Acknowledge the drift; the warning banner stays.
          </p>
        </button>
      </div>
    </div>
  );
}
