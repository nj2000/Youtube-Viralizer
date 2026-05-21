"use client";

import { ThumbnailHeader } from "./shared";

// State 1 — generating. One skeleton card per concept while the per-trigger
// Haiku calls run.
export function GeneratingCard({
  progressMessage,
}: {
  progressMessage: string | null;
}) {
  return (
    <li className="card rounded-2xl p-5">
      <ThumbnailHeader
        pill="Designing concepts…"
        pillClass="bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30"
        subtitle={progressMessage ?? "Drafting one thumbnail concept per locked title…"}
      />
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl p-3 ring-1 ring-white/5 bg-white/[0.025]"
          >
            <div className="aspect-[16/9] rounded-lg bg-white/5 animate-pulse" />
            <div className="mt-3 h-3 w-20 rounded bg-white/10 animate-pulse" />
            <div className="mt-2 h-3 rounded bg-white/10 animate-pulse" />
            <div className="mt-1.5 h-3 w-2/3 rounded bg-white/10 animate-pulse" />
          </div>
        ))}
      </div>
    </li>
  );
}
