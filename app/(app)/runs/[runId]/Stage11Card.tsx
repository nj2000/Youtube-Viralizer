"use client";

import { useMemo } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { ABPlanSchema, type ABPlan } from "@/lib/validation/ab-plan";
import { useAbPlan } from "@/lib/hooks/useAbPlan";

import type { StageCardState } from "./StageCard";
import { DecisionRules, ScheduleTimeline, VariantCard } from "./stage11/parts";

export type Stage11CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
  errorCode: string | null;
};

function tryParse(payload: unknown): ABPlan | null {
  if (payload === null || payload === undefined) return null;
  const parsed = ABPlanSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function Pill({ text, tone }: { text: string; tone: "ok" | "warn" | "err" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
      : tone === "warn"
        ? "bg-blue-500/10 text-blue-400 ring-blue-500/30"
        : "bg-rose-500/10 text-rose-300 ring-rose-500/30";
  return (
    <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 ${cls}`}>
      {text}
    </span>
  );
}

export function Stage11Card({ run, cardState, progressMessage, errorCode }: Stage11CardProps) {
  const data = useMemo(() => tryParse(run.abPlanData), [run.abPlanData]);

  if (cardState === "running") {
    return (
      <li className="card rounded-2xl p-5">
        <h2 className="text-base font-extrabold tracking-tight text-white">
          A/B Test Plan <Pill text="Building…" tone="warn" />
        </h2>
        <p className="text-xs text-ink-400 mt-3">{progressMessage ?? "Framing 3 hypotheses…"}</p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 rounded-xl bg-white/[0.025] ring-1 ring-white/5 animate-pulse" />
          ))}
        </div>
      </li>
    );
  }

  if (data) return <AbView data={data} runId={run.id} />;

  if (run.titlesData === null || run.thumbnailsData === null) {
    return <Pending label="Generate titles + thumbnails for all 3 triggers first." />;
  }
  return <ReadyCard runId={run.id} errorCode={errorCode} />;
}

function AbView({ data, runId }: { data: ABPlan; runId: string }) {
  const ab = useAbPlan(runId);
  return (
    <li className="space-y-4">
      <div className="card rounded-2xl p-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-white">
            A/B Test Plan <Pill text="Generated" tone="ok" />
          </h2>
          <p className="text-xs text-ink-400 mt-1">
            3 hypotheses · 48-hour timeline · built so the result teaches you something.
          </p>
          {ab.error && <p className="mt-2 text-xs text-rose-300/80 font-mono">{ab.error}</p>}
        </div>
        <button
          type="button"
          onClick={() => ab.copyMarkdown(runId)}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold shrink-0"
        >
          Copy plan
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {data.variants.map((v, i) => (
          <VariantCard
            key={v.trigger}
            variant={v}
            index={i}
            shipDefault={i === data.shipDefault}
            baselineCtrBp={data.baselineCtrBp}
            pending={ab.pending.has(i)}
            onRegenerate={() => ab.regenerate(i as 0 | 1 | 2)}
          />
        ))}
      </div>

      <ScheduleTimeline schedule={data.schedule} />
      <DecisionRules rules={data.decisionRules} />

      <div className="card rounded-2xl p-5">
        <h3 className="text-base font-bold text-white">What this test will teach you</h3>
        <p className="text-sm text-ink-200 mt-2 leading-relaxed">{data.crossTestLearning}</p>
        <p className="text-[11px] text-ink-400 mt-3">{data.sampleSizeNote}</p>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] ring-1 ring-white/5 p-3">
          <p className="text-[11px] text-ink-400">
            <span className="font-semibold text-ink-200">Send results back</span> — after hour 48, the calibration loop (Feature #17) will weight future kits toward what won.
          </p>
          <button
            type="button"
            disabled
            title="Coming in Phase 2 with the calibration loop"
            className="text-xs font-semibold text-ink-500 bg-white/5 ring-1 ring-white/10 px-3 py-1.5 rounded-md cursor-not-allowed shrink-0"
          >
            Log result (v2)
          </button>
        </div>
      </div>
    </li>
  );
}

function ReadyCard({ runId, errorCode }: { runId: string; errorCode: string | null }) {
  const ab = useAbPlan(runId);
  return (
    <li className="card rounded-2xl p-5">
      <h2 className="text-base font-extrabold tracking-tight text-white">
        A/B Test Plan <Pill text={errorCode ? "Failed" : "Ready"} tone={errorCode ? "err" : "ok"} />
      </h2>
      <p className="text-xs text-ink-400 mt-1">
        {errorCode ? "Couldn't build the A/B plan — retry." : "3-arm test from your titles × thumbnails, with decision rules."}
      </p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={ab.busy}
          onClick={() => ab.runPlan()}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
        >
          {ab.busy ? "Starting…" : errorCode ? "Retry" : "Generate A/B plan"}
        </button>
      </div>
    </li>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        11
      </span>
      <p className="text-sm font-semibold text-white">
        11 · A/B test plan
        <span className="text-xs font-normal text-ink-400 ml-1">· {label}</span>
      </p>
    </li>
  );
}
