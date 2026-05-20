"use client";

import { StageHeader } from "./shared";

const TRIGGERS = ["curiosity", "fear", "result"] as const;

function activeIndex(progressMessage: string | null): number {
  if (!progressMessage) return 0;
  const m = progressMessage.toLowerCase();
  if (m.includes("intent")) return 3;
  if (m.includes("result")) return 2;
  if (m.includes("fear")) return 1;
  if (m.includes("curiosity")) return 0;
  if (m.includes("diversity")) return 0;
  return 0;
}

export function GeneratingCard({
  progressMessage,
}: {
  progressMessage: string | null;
}) {
  const idx = activeIndex(progressMessage);
  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill="Stage 5 · Running"
        pillClass="bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30"
        subtitle={progressMessage ?? "Writing three titles…"}
      />
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {TRIGGERS.map((t, i) => (
          <div
            key={t}
            className={`rounded-lg p-4 ring-1 ring-white/5 ${i <= idx ? "bg-white/[0.04]" : "bg-white/[0.02] opacity-50"}`}
          >
            <p className="text-[10px] uppercase tracking-wider text-ink-400">
              {t}
            </p>
            <div className="mt-2 h-3 rounded bg-white/10 animate-pulse" />
            <div className="mt-1.5 h-3 w-2/3 rounded bg-white/10 animate-pulse" />
            {i === idx && (
              <span className="mt-3 inline-block h-1.5 w-1.5 rounded-full bg-blue-400 pulse-dot" />
            )}
          </div>
        ))}
      </div>
    </li>
  );
}
