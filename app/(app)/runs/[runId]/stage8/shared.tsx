"use client";

import type { LintSeverity } from "@/lib/validation/lint";

// Full class literals so Tailwind v4's scanner can see them.
export const SEVERITY_BADGE: Record<LintSeverity, string> = {
  error: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
  warning: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  info: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30",
};

export const SEVERITY_CHIP: Record<LintSeverity, string> = {
  error: "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/25",
  warning: "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/25",
  info: "bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/25",
};

export const SEVERITY_HL: Record<LintSeverity, string> = {
  error: "bg-rose-500/15 text-rose-200",
  warning: "bg-amber-500/15 text-amber-200",
  info: "bg-blue-500/15 text-blue-200",
};

export const SEVERITY_LABEL: Record<LintSeverity, string> = {
  error: "Error",
  warning: "Warn",
  info: "Info",
};

export function Stage8Header({
  pill,
  pillClass,
  subtitle,
  right,
}: {
  pill: string;
  pillClass: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-extrabold tracking-tight text-white">
          Script Quality Check
          <span
            className={`ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${pillClass}`}
          >
            {pill}
          </span>
        </h2>
        <p className="text-xs text-ink-400 mt-1">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

export function scannedSubtitle(words: number, durationMs: number): string {
  const secs = (durationMs / 1000).toFixed(1);
  return `Stage 8 of 12 · Haiku 4.5 · ${words.toLocaleString()} words scanned in ${secs}s`;
}
