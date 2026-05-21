"use client";

import { useMemo, useState } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { LintDataSchema, type LintData } from "@/lib/validation/lint";
import { useLint } from "@/lib/hooks/useLint";

import type { StageCardState } from "./StageCard";
import { CleanCard } from "./stage8/CleanCard";
import { ErrorCard } from "./stage8/ErrorCard";
import { GeneratingCard } from "./stage8/GeneratingCard";
import { ResultsCard } from "./stage8/ResultsCard";
import { Stage8Header } from "./stage8/shared";

export type Stage8CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
  errorCode: string | null;
};

function tryParse(payload: unknown): LintData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = LintDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function Stage8Card({
  run,
  cardState,
  progressMessage,
  errorCode,
}: Stage8CardProps) {
  const data = useMemo(() => tryParse(run.lintData), [run.lintData]);

  if (cardState === "running") {
    return <GeneratingCard progressMessage={progressMessage} />;
  }

  if (data) {
    const active = data.issues.filter((i) => !i.dismissed);
    if (active.length === 0 && data.drift.passed) {
      return <CleanCard data={data} runId={run.id} />;
    }
    return <ResultsCard data={data} runId={run.id} />;
  }

  if (run.scriptData === null) {
    return <ErrorCard runId={run.id} variant="missing" errorCode={errorCode} />;
  }
  if (errorCode) {
    return <ErrorCard runId={run.id} variant="upstream" errorCode={errorCode} />;
  }
  return <ReadyCard runId={run.id} />;
}

// Lint normally auto-runs after the script; this covers the brief window before
// it lands (or a manual trigger).
function ReadyCard({ runId }: { runId: string }) {
  const lint = useLint(runId);
  const [running, setRunning] = useState(false);

  return (
    <li className="card rounded-2xl p-5">
      <Stage8Header
        pill="Ready"
        pillClass="bg-white/5 text-ink-300 ring-1 ring-white/10"
        subtitle="Lint runs automatically once the script is ready."
      />
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              await lint.runLint();
            } finally {
              setRunning(false);
            }
          }}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
        >
          {running ? "Starting…" : "Run lint now"}
        </button>
      </div>
    </li>
  );
}
