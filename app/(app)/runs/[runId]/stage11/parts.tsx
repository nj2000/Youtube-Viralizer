"use client";

import type { TitleTrigger } from "@/lib/validation/titles";
import type { ABPlan, ABVariant, DecisionRuleKind } from "@/lib/validation/ab-plan";

// Full literal classes for the Tailwind v4 scanner.
const TRIGGER_BADGE: Record<TitleTrigger, string> = {
  curiosity: "bg-curiosity-500/15 text-curiosity-500 ring-curiosity-500/35",
  fear: "bg-fear-500/15 text-fear-500 ring-fear-500/35",
  result: "bg-result-500/15 text-result-500 ring-result-500/35",
};
const TRIGGER_BORDER: Record<TitleTrigger, string> = {
  curiosity: "border-l-curiosity-500",
  fear: "border-l-fear-500",
  result: "border-l-result-500",
};
const RULE_BADGE: Record<DecisionRuleKind, string> = {
  promote: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  hold: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  regenerate: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

function pct(bp: number): string {
  const sign = bp > 0 ? "+" : "";
  return `${sign}${Math.round(bp / 100)}%`;
}

export function VariantCard({
  variant,
  index,
  shipDefault,
  baselineCtrBp,
  pending,
  onRegenerate,
}: {
  variant: ABVariant;
  index: number;
  shipDefault: boolean;
  baselineCtrBp: number;
  pending: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className={`card rounded-2xl p-5 border-l-[3px] ${TRIGGER_BORDER[variant.trigger]} flex flex-col`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${TRIGGER_BADGE[variant.trigger]}`}>
          {variant.trigger}
        </span>
        <span className="text-[10px] font-mono text-ink-400">variant {index + 1}</span>
      </div>
      {shipDefault && (
        <span className="mt-2 inline-flex w-fit items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 bg-emerald-500/15 text-emerald-300 ring-emerald-500/30">
          ship-default
        </span>
      )}
      <p className="text-sm font-extrabold text-white leading-snug mt-2">{variant.titleText}</p>

      <p className="text-[10px] uppercase tracking-wider font-bold text-ink-400 mt-3">Hypothesis</p>
      <p className="text-sm text-ink-200 mt-1 leading-relaxed">{variant.hypothesis}</p>

      <div className="mt-3 card-row rounded-lg p-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Predicted CTR delta</p>
          <p className="text-lg font-extrabold text-white font-mono">
            {pct(variant.predictedCtrDelta.minBp)} to {pct(variant.predictedCtrDelta.maxBp)}
          </p>
        </div>
        <p className="text-[10px] text-ink-400 text-right">
          vs baseline
          <br />
          {(baselineCtrBp / 100).toFixed(1)}%
        </p>
      </div>

      <p className="text-[10px] uppercase tracking-wider font-bold text-ink-400 mt-3">If this wins</p>
      <p className="text-xs text-ink-300 mt-1 leading-relaxed">{variant.ifThisWinsLearning}</p>

      <button
        type="button"
        disabled={pending}
        onClick={onRegenerate}
        className="mt-auto pt-4 text-xs font-medium text-ink-400 hover:text-white transition disabled:opacity-50 self-end"
      >
        {pending ? "…" : "Regenerate"}
      </button>
    </div>
  );
}

export function ScheduleTimeline({ schedule }: { schedule: ABPlan["schedule"] }) {
  return (
    <div className="card rounded-2xl p-5">
      <h3 className="text-base font-bold text-white">Test schedule</h3>
      <p className="text-[11px] text-ink-400">48-hour window · decision gates at 24h and 48h.</p>
      <div className="mt-4 grid grid-cols-4 gap-3">
        {schedule.map((s) => (
          <div key={s.hour} className="card-row rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${s.decisionGate ? "bg-yt-500" : "bg-white/20"}`} />
              <span className="text-sm font-bold text-white">{s.hour}h</span>
              <span className="text-[10px] text-ink-400">{s.label}</span>
            </div>
            <p className="text-[11px] text-ink-300 mt-1.5 leading-relaxed">{s.action}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DecisionRules({ rules }: { rules: ABPlan["decisionRules"] }) {
  return (
    <div className="card rounded-2xl p-5">
      <h3 className="text-base font-bold text-white">Decision rules</h3>
      <ul className="mt-3 space-y-2">
        {rules.map((r, i) => (
          <li key={i} className="card-row rounded-lg p-3 flex items-start gap-3">
            <span className={`inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 shrink-0 ${RULE_BADGE[r.kind]}`}>
              {r.kind}
            </span>
            <p className="text-xs text-ink-200 leading-relaxed">
              <span className="text-ink-400">h{r.evaluateAtHour}:</span> {r.conditionText} → {r.actionText}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
