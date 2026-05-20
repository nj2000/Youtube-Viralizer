"use client";

import { useMemo, useState } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
  hasAnyLockedTitle,
  type TitlesData,
} from "@/lib/validation/titles";

import type { StageCardState } from "./StageCard";
import { GeneratingCard } from "./stage5/GeneratingCard";
import { TitleCard } from "./stage5/TitleCard";

export type Stage5CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
};

function tryParse(payload: unknown): TitlesData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = TitlesDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function Stage5Card({
  run,
  cardState,
  progressMessage,
}: Stage5CardProps) {
  const data = useMemo(() => tryParse(run.titlesData), [run.titlesData]);

  if (cardState === "running") {
    return <GeneratingCard progressMessage={progressMessage} />;
  }
  if (data) {
    return <TitlesView data={data} stale={cardState === "stale"} runId={run.id} />;
  }
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        5
      </span>
      <p className="text-sm font-semibold text-white">
        5 · Titles
        <span className="text-xs font-normal text-ink-400 ml-1">
          {cardState === "error" ? "· failed" : "· pending"}
        </span>
      </p>
    </li>
  );
}

function TitlesView({
  data,
  stale,
  runId,
}: {
  data: TitlesData;
  stale: boolean;
  runId: string;
}) {
  const anyLocked = hasAnyLockedTitle(data);
  const [continuing, setContinuing] = useState(false);

  async function onContinue() {
    setContinuing(true);
    try {
      await fetch(`/api/runs/${runId}/continue`, { method: "POST" });
    } finally {
      setContinuing(false);
    }
  }

  return (
    <li className="card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-white">
            Titles
            <span
              className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                stale
                  ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
                  : "bg-result-500/10 text-result-500 ring-1 ring-result-500/30"
              }`}
            >
              Stage 5 · {stale ? "Stale" : "Ready"}
            </span>
          </h2>
          <p className="text-xs text-ink-400 mt-1">
            Three angles — lock at least one to continue. Lock multiple to A/B
            test downstream.
          </p>
        </div>
      </div>

      {(data.flags.voiceFallback ||
        data.flags.diversityWarning ||
        data.flags.truncationOccurred) && (
        <div className="mt-3 space-y-2">
          {data.flags.voiceFallback && (
            <Banner text="Niche-fallback voice — this channel has fewer than 3 recent titles, so voice matching used the niche default." />
          )}
          {data.flags.diversityWarning && (
            <Banner text="Titles came back similar even after a retry — they may not be as distinct as ideal." />
          )}
          {data.flags.truncationOccurred && (
            <Banner text="One or more titles overshot 100 characters and were re-prompted for length." />
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {TRIGGER_ORDER.map((t) =>
          data[t] ? <TitleCard key={t} runId={runId} variant={data[t]!} /> : null,
        )}
      </div>

      {data.intentRewrites.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            Intent rewrites
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {data.intentRewrites.map((r, i) => (
              <li
                key={i}
                className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 ring-1 ring-white/10 text-ink-300"
              >
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400">
          {anyLocked
            ? "Locked — ready to continue."
            : "Lock in at least one title to continue."}
        </p>
        <button
          type="button"
          disabled={!anyLocked || continuing}
          onClick={onContinue}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continuing ? "Starting…" : "Continue to thumbnails →"}
        </button>
      </div>
    </li>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <div className="rounded-md bg-amber-500/[0.06] ring-1 ring-amber-500/20 p-2.5 text-[11px] text-amber-200">
      {text}
    </div>
  );
}
