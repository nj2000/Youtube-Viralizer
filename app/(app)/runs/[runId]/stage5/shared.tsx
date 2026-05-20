"use client";

import type { TitleTrigger } from "@/lib/validation/titles";

// Full class literals so Tailwind v4's content scanner picks them up.
export const TRIGGER_STYLE: Record<
  TitleTrigger,
  { badge: string; accentText: string; bar: string; label: string }
> = {
  curiosity: {
    badge: "bg-curiosity-500/15 text-curiosity-500 ring-curiosity-500/35",
    accentText: "text-curiosity-500",
    bar: "bg-gradient-to-r from-curiosity-500/50 to-curiosity-500",
    label: "Curiosity",
  },
  fear: {
    badge: "bg-fear-500/15 text-fear-500 ring-fear-500/35",
    accentText: "text-fear-500",
    bar: "bg-gradient-to-r from-fear-500/50 to-fear-500",
    label: "Fear",
  },
  result: {
    badge: "bg-result-500/15 text-result-500 ring-result-500/35",
    accentText: "text-result-500",
    bar: "bg-gradient-to-r from-result-500/50 to-result-500",
    label: "Result",
  },
};

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
          Titles
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

// CTR meter fill width clamped to a sane 0-100 visual range.
export function ctrWidthPct(predictedCtrLift: number): number {
  return Math.max(0, Math.min(100, 50 + predictedCtrLift / 2));
}

export function charCounterClass(charCount: number): string {
  if (charCount > 100) return "text-fear-500";
  if (charCount > 70) return "text-amber-400";
  return "text-ink-400";
}
