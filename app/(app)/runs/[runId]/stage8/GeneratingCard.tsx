"use client";

import { Stage8Header } from "./shared";

const RULE_GROUPS = [
  "cliche/*",
  "ai-tell/*",
  "hostage-engagement/*",
  "keyword-vomit/*",
  "pacing/*",
  "drift/topic-shift",
];

// State 1 — lint running. Bus progress drives the subtitle; the rule grid +
// shimmer rows are presentational while the two Haiku passes run.
export function GeneratingCard({
  progressMessage,
}: {
  progressMessage: string | null;
}) {
  return (
    <li className="card rounded-2xl p-5">
      <Stage8Header
        pill="Checking for retention killers…"
        pillClass="bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30"
        subtitle={progressMessage ?? "Scanning the script against 19 anti-pattern rules…"}
      />

      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
        {RULE_GROUPS.map((group) => (
          <div
            key={group}
            className="rounded-lg px-3 py-2 ring-1 ring-white/5 bg-white/[0.025] flex items-center gap-2"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 pulse-dot" />
            <span className="text-[11px] font-mono text-ink-300">{group}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-lg p-4 ring-1 ring-white/5 bg-white/[0.025]"
          >
            <div className="h-3 w-32 rounded bg-white/10 animate-pulse" />
            <div className="mt-2 h-3 rounded bg-white/10 animate-pulse" />
          </div>
        ))}
      </div>
    </li>
  );
}
