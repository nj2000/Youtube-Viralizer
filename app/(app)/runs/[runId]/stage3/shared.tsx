"use client";

import type { TriggerLabel } from "@/lib/validation/competitor";

// Full class literals so Tailwind v4's content scanner picks them up —
// dynamic `bg-${color}/10` strings are invisible to the scanner.
export const TRIGGER_CHIP_CLASS: Record<TriggerLabel, string> = {
  curiosity_gap:
    "bg-curiosity-500/10 text-curiosity-500 ring-curiosity-500/30",
  fear: "bg-fear-500/10 text-fear-500 ring-fear-500/30",
  specific_result: "bg-result-500/10 text-result-500 ring-result-500/30",
  first_person:
    "bg-curiosity-500/10 text-curiosity-500 ring-curiosity-500/30",
  payoff_promise: "bg-result-500/10 text-result-500 ring-result-500/30",
  negation: "bg-fear-500/10 text-fear-500 ring-fear-500/30",
  specific_dollar_amount:
    "bg-result-500/10 text-result-500 ring-result-500/30",
  personal_experiment:
    "bg-curiosity-500/10 text-curiosity-500 ring-curiosity-500/30",
};

export const TRIGGER_LABEL_HUMAN: Record<TriggerLabel, string> = {
  curiosity_gap: "curiosity gap",
  fear: "fear",
  specific_result: "result",
  first_person: "first-person",
  payoff_promise: "payoff promise",
  negation: "negation",
  specific_dollar_amount: "dollar amount",
  personal_experiment: "experiment",
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
          Competitor outliers
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
