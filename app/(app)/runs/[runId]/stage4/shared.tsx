"use client";

import type { ScoreDimensions } from "@/lib/validation/score";

export const DIMENSION_ORDER: Array<keyof ScoreDimensions> = [
  "hook_strength",
  "curiosity_gap",
  "outlier_alignment",
  "niche_fit",
  "title_ability",
];

export const DIMENSION_LABEL: Record<keyof ScoreDimensions, string> = {
  hook_strength: "Hook strength",
  curiosity_gap: "Curiosity gap",
  outlier_alignment: "Outlier alignment",
  niche_fit: "Niche fit",
  title_ability: "Title-ability",
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
          Idea score &amp; gate
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

export function DimensionBars({
  dimensions,
  tone,
}: {
  dimensions: ScoreDimensions;
  tone: "pass" | "fail";
}) {
  return (
    <div className="mt-4 space-y-2">
      {DIMENSION_ORDER.map((dim) => {
        const value = dimensions[dim];
        const barColor =
          tone === "pass"
            ? "bg-gradient-to-r from-result-500/60 to-result-500"
            : value >= 70
              ? "bg-gradient-to-r from-amber-500/55 to-amber-500"
              : "bg-gradient-to-r from-fear-500/55 to-fear-500";
        return (
          <div key={dim} className="flex items-center gap-3">
            <span className="w-44 text-xs text-ink-300">
              {DIMENSION_LABEL[dim]}
            </span>
            <div className="flex-1 h-2 rounded-full bg-white/[0.05] ring-1 ring-white/5 overflow-hidden">
              <div
                className={`h-full ${barColor}`}
                style={{ width: `${value}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs font-mono text-white">
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
