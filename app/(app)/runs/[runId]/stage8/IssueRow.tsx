"use client";

import type { LintIssue } from "@/lib/validation/lint";

import { SEVERITY_BADGE, SEVERITY_CHIP, SEVERITY_LABEL } from "./shared";

function locationLabel(issue: LintIssue): string {
  if (issue.sectionIndex < 0) return "global";
  if (issue.lineRange.end > issue.lineRange.start) {
    return `S${issue.sectionIndex} · ${issue.lineRange.start}–${issue.lineRange.end}`;
  }
  return `S${issue.sectionIndex}`;
}

// One issue row (State 3). Drift issues never reach here — they're surfaced in
// the drift banner. Accepted issues collapse to a "Fixed" pill.
export function IssueRow({
  issue,
  pending,
  onAccept,
  onDismiss,
}: {
  issue: LintIssue;
  pending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const fixable = issue.suggestedFix !== null && issue.sectionIndex >= 0;

  return (
    <div className="flex items-start gap-3 py-4">
      <div className="shrink-0 flex flex-col items-start gap-1">
        <span
          className={`inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE[issue.severity]}`}
        >
          {SEVERITY_LABEL[issue.severity]}
        </span>
        <span className="text-[10px] font-mono text-ink-500">
          {locationLabel(issue)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code
            className={`text-[11px] font-mono px-2 py-0.5 rounded ${SEVERITY_CHIP[issue.severity]}`}
          >
            {issue.ruleId}
          </code>
          <span className="text-sm text-ink-200">{issue.message}</span>
        </div>

        <div className="mt-2 rounded-lg bg-ink-900/80 ring-1 ring-white/5 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-500">
            Excerpt
          </p>
          <p className="text-[13px] text-ink-200 mt-1 leading-relaxed">
            {issue.excerpt}
          </p>
        </div>

        {issue.suggestedFix !== null && (
          <div className="mt-2 rounded-lg bg-emerald-500/5 ring-1 ring-emerald-500/15 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">
              Suggested rewrite
            </p>
            <p className="text-[13px] text-emerald-100/90 mt-1 leading-relaxed">
              {issue.suggestedFix}
            </p>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          {issue.accepted ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/25 px-3 py-1.5 rounded-md">
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path d="m5 12 5 5L20 7" />
              </svg>
              Fixed
            </span>
          ) : (
            <>
              {fixable && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={onAccept}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15 ring-1 ring-emerald-500/25 px-3 py-1.5 rounded-md transition disabled:opacity-50"
                >
                  {pending ? "…" : "Accept fix"}
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={onDismiss}
                className="text-xs font-semibold text-ink-400 hover:text-ink-200 px-3 py-1.5 rounded-md transition disabled:opacity-50"
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
