"use client";

import type { DropoffRisk, HookArchetype } from "@/lib/validation/hook";

// Full class literals for Tailwind v4's scanner.
export const RISK_STYLE: Record<DropoffRisk, string> = {
  low: "bg-result-500/15 text-result-500 ring-result-500/35",
  medium: "bg-amber-500/15 text-amber-400 ring-amber-500/35",
  high: "bg-fear-500/15 text-fear-500 ring-fear-500/35",
};

export const ARCHETYPE_LABEL: Record<HookArchetype, string> = {
  shock: "Shock",
  "curiosity-gap": "Curiosity gap",
  story: "Story",
  "problem-agitation": "Problem · agitation",
  "social-proof": "Social proof",
};

export function formatMSS(timeSec: number): string {
  const m = Math.floor(timeSec / 60);
  const s = timeSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StageHeader({
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
          Cold-open hook
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
