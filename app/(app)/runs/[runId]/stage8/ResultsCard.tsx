"use client";

import { useMemo } from "react";

import { isDriftRule, type LintData } from "@/lib/validation/lint";
import { useLint } from "@/lib/hooks/useLint";

import { DriftBanner } from "./DriftBanner";
import { IssueRow } from "./IssueRow";
import { Stage8Header, scannedSubtitle } from "./shared";

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-lg px-3 py-3 ring-1 ${tone}`}>
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-2xl font-extrabold font-mono mt-1">{value}</p>
    </div>
  );
}

// State 3 (+ State 4 drift banner). Renders the summary, optional drift banner,
// the non-drift issue rows, and the apply-all / override footer.
export function ResultsCard({ data, runId }: { data: LintData; runId: string }) {
  const lint = useLint(runId);

  const rows = useMemo(
    () => data.issues.filter((i) => !i.dismissed && !isDriftRule(i.ruleId)),
    [data.issues],
  );
  const openFixable = rows.filter(
    (i) => !i.accepted && i.suggestedFix !== null && i.sectionIndex >= 0,
  ).length;
  const total = data.summary.errors + data.summary.warnings + data.summary.infos;
  const driftFailed = !data.drift.passed;

  return (
    <li className="card rounded-2xl p-5">
      <Stage8Header
        pill={driftFailed ? "Drift failed" : "Needs review"}
        pillClass={
          driftFailed
            ? "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
            : "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30"
        }
        subtitle={scannedSubtitle(data.scanWordCount, data.scanDurationMs)}
        right={
          <button
            type="button"
            disabled={lint.busy}
            onClick={() => lint.rerun(true)}
            className="text-xs text-ink-400 hover:text-white disabled:opacity-50 transition"
          >
            Re-run lint
          </button>
        }
      />

      <div className="mt-4 grid grid-cols-4 gap-2">
        <Stat label="Total issues" value={total} tone="bg-white/[0.03] ring-white/5" />
        <Stat label="Critical" value={data.summary.errors} tone="bg-rose-500/8 ring-rose-500/20" />
        <Stat label="Warnings" value={data.summary.warnings} tone="bg-amber-500/8 ring-amber-500/20" />
        <Stat label="Info" value={data.summary.infos} tone="bg-blue-500/8 ring-blue-500/20" />
      </div>

      <p className="mt-3 text-xs">
        <span className="text-ink-400">Would block publish? </span>
        {data.overridden ? (
          <span className="font-semibold text-amber-300">No · overridden</span>
        ) : data.summary.blocking ? (
          <span className="font-semibold text-rose-300">
            Yes
            {data.summary.errors > 0
              ? ` — ${data.summary.errors} critical issue${data.summary.errors > 1 ? "s" : ""}`
              : " — drift failed"}
          </span>
        ) : (
          <span className="font-semibold text-white">No</span>
        )}
      </p>

      {driftFailed && <DriftBanner runId={runId} drift={data.drift} />}

      {rows.length > 0 && (
        <div className="mt-4 divide-y divide-white/5">
          {rows.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              pending={lint.pending.has(issue.id)}
              onAccept={() => lint.acceptIssue(issue.id)}
              onDismiss={() => lint.dismissIssue(issue.id)}
            />
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        {data.summary.blocking && !data.overridden && (
          <button
            type="button"
            disabled={lint.busy}
            onClick={() => lint.override()}
            className="text-sm px-4 py-2 rounded-lg bg-white/5 ring-1 ring-white/10 text-ink-200 hover:bg-white/10 disabled:opacity-50 transition"
          >
            Override &amp; continue
          </button>
        )}
        <button
          type="button"
          disabled={lint.busy || openFixable === 0}
          onClick={() => lint.applyAll()}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {lint.busy ? "Applying…" : `Apply all suggestions${openFixable ? ` (${openFixable})` : ""}`}
        </button>
      </div>

      {lint.error && (
        <p className="mt-2 text-xs text-rose-300/80 text-right font-mono">
          {lint.error}
        </p>
      )}
    </li>
  );
}
