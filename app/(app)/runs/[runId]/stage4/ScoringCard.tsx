"use client";

import { StageHeader } from "./shared";

const SUBSTEPS = [
  "Reading idea + competitor patterns",
  "Scoring 5 dimensions",
  "Computing weighted final",
  "Evaluating 92-point gate",
];

function currentSubstepIndex(progressMessage: string | null): number {
  if (!progressMessage) return 0;
  const m = progressMessage.toLowerCase();
  if (m.includes("gate ") || m.includes("evaluating")) return 3;
  if (m.includes("final score")) return 2;
  if (
    m.includes("hook ") ||
    m.includes("curiosity") ||
    m.includes("outlier ") ||
    m.includes("niche") ||
    m.includes("title-ability") ||
    m.includes("title ")
  )
    return 1;
  return 0;
}

export function ScoringCard({
  progressMessage,
}: {
  progressMessage: string | null;
}) {
  const activeIdx = currentSubstepIndex(progressMessage);
  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill="Stage 4 · Running"
        pillClass="bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30"
        subtitle={progressMessage ?? "Scoring idea via Opus 4.7…"}
      />
      <ol className="mt-4 space-y-2">
        {SUBSTEPS.map((step, i) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <li
              key={step}
              className={`flex items-center gap-3 text-sm ${isActive ? "text-white" : isDone ? "text-emerald-400" : "text-ink-500"}`}
            >
              <span
                className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ring-1 ${
                  isActive
                    ? "bg-blue-500/15 text-blue-400 ring-blue-500/30"
                    : isDone
                      ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
                      : "bg-white/5 text-ink-400 ring-white/10"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span>{step}</span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 pulse-dot ml-auto" />
              )}
            </li>
          );
        })}
      </ol>
    </li>
  );
}
