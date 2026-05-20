"use client";

import { StageHeader } from "./shared";

export function GeneratingCard({
  progressMessage,
}: {
  progressMessage: string | null;
}) {
  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill="Stage 6 · Running"
        pillClass="bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30"
        subtitle={progressMessage ?? "Engineering 3 cold-open hooks…"}
      />
      <div className="mt-4 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg p-4 ring-1 ring-white/5 bg-white/[0.025]">
            <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
            <div className="mt-2 h-3 rounded bg-white/10 animate-pulse" />
            <div className="mt-1.5 h-3 w-2/3 rounded bg-white/10 animate-pulse" />
          </div>
        ))}
      </div>
    </li>
  );
}
