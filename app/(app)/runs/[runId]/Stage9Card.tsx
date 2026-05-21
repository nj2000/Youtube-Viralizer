"use client";

import { useMemo } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
  type TitleTrigger,
} from "@/lib/validation/titles";
import {
  ThumbnailsDataSchema,
  type ThumbnailsData,
} from "@/lib/validation/thumbnails";
import { useThumbnails } from "@/lib/hooks/useThumbnails";

import type { StageCardState } from "./StageCard";
import { GeneratingCard } from "./stage9/GeneratingCard";
import { ThumbnailBriefCard } from "./stage9/ThumbnailBriefCard";
import { ThumbnailHeader } from "./stage9/shared";

export type Stage9CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
  errorCode: string | null;
};

function tryParse(payload: unknown): ThumbnailsData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = ThumbnailsDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function lockedTitleMap(payload: unknown): Record<TitleTrigger, string | null> {
  const out: Record<TitleTrigger, string | null> = {
    curiosity: null,
    fear: null,
    result: null,
  };
  const parsed = TitlesDataSchema.safeParse(payload);
  if (!parsed.success) return out;
  for (const t of TRIGGER_ORDER) {
    const v = parsed.data[t];
    if (v && v.lockedIn) out[t] = v.text;
  }
  return out;
}

export function Stage9Card({
  run,
  cardState,
  progressMessage,
  errorCode,
}: Stage9CardProps) {
  const data = useMemo(() => tryParse(run.thumbnailsData), [run.thumbnailsData]);
  const lockedTitles = useMemo(
    () => lockedTitleMap(run.titlesData),
    [run.titlesData],
  );

  if (cardState === "running") {
    return <GeneratingCard progressMessage={progressMessage} />;
  }
  if (data) {
    return <ThumbnailsView data={data} lockedTitles={lockedTitles} runId={run.id} />;
  }
  if (run.titlesData === null) {
    return <Pending label="Lock a title first to generate thumbnail concepts." />;
  }
  return <ReadyCard runId={run.id} errorCode={errorCode} />;
}

function ThumbnailsView({
  data,
  lockedTitles,
  runId,
}: {
  data: ThumbnailsData;
  lockedTitles: Record<TitleTrigger, string | null>;
  runId: string;
}) {
  const thumbs = useThumbnails(runId);
  const present = TRIGGER_ORDER.filter((t) => data[t] !== null);

  return (
    <li className="card rounded-2xl p-5">
      <ThumbnailHeader
        pill="Generated"
        pillClass="bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25"
        subtitle="One concept per locked title. Each is portable to Canva, Photoshop, or Figma."
      />

      <div className="mt-3 space-y-2">
        {data.flags.partialReturn && (
          <Banner text="Some concepts couldn't be generated and were skipped — regenerate them individually." />
        )}
        {data.flags.diversityWarning && (
          <Banner text="Concepts came back visually similar — consider regenerating one for more contrast." />
        )}
        {data.flags.paletteContrastFail && (
          <Banner text="A palette couldn't reach WCAG-AA contrast even after auto-fix — double-check legibility." />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {present.map((t, i) => (
          <ThumbnailBriefCard
            key={t}
            brief={data[t]!}
            trigger={t}
            index={i}
            stale={data[t]!.pairsWithTitle !== lockedTitles[t]}
            pending={thumbs.pending.has(t)}
            onRegenerate={() => thumbs.regenerate(t)}
          />
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/[0.05] ring-1 ring-amber-500/20 p-3">
        <span className="text-amber-400 text-sm">ⓘ</span>
        <p className="text-[12px] text-amber-200/90 leading-relaxed">
          <span className="font-semibold">Phase 1: text-only briefs.</span>{" "}
          AI-generated finished images + per-creator LoRA arrive in Phase 3
          (Features #23/#24). For now, briefs hand off cleanly to a designer.
        </p>
      </div>

      {thumbs.error && (
        <p className="mt-2 text-xs text-rose-300/80 font-mono">{thumbs.error}</p>
      )}
    </li>
  );
}

function ReadyCard({
  runId,
  errorCode,
}: {
  runId: string;
  errorCode: string | null;
}) {
  const thumbs = useThumbnails(runId);
  return (
    <li className="card rounded-2xl p-5">
      <ThumbnailHeader
        pill={errorCode ? "Failed" : "Ready"}
        pillClass={
          errorCode
            ? "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
            : "bg-white/5 text-ink-300 ring-1 ring-white/10"
        }
        subtitle={
          errorCode
            ? "Couldn't generate thumbnail concepts — retry."
            : "Generate one thumbnail concept per locked title."
        }
      />
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={thumbs.busy}
          onClick={() => thumbs.runThumbnails()}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
        >
          {thumbs.busy ? "Starting…" : errorCode ? "Retry" : "Generate concepts"}
        </button>
      </div>
    </li>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        9
      </span>
      <p className="text-sm font-semibold text-white">
        9 · Thumbnail briefs
        <span className="text-xs font-normal text-ink-400 ml-1">· {label}</span>
      </p>
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
