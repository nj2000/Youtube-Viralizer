"use client";

import { useMemo, useState } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { HookDataSchema } from "@/lib/validation/hook";
import { TitlesDataSchema, hasAnyLockedTitle } from "@/lib/validation/titles";
import {
  SCRIPT_TARGET_MINUTES,
  ScriptDataSchema,
  type ScriptData,
  type ScriptTargetMinutes,
} from "@/lib/validation/script";
import { useScriptStream } from "@/lib/hooks/useScriptStream";

import type { StageCardState } from "./StageCard";
import { ScriptView } from "./stage7/ScriptView";
import { StageHeader } from "./stage7/shared";

export type Stage7CardProps = {
  run: RunRowView;
  cardState: StageCardState;
};

function parseScript(payload: unknown): ScriptData | null {
  const parsed = ScriptDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function prereqsMet(run: RunRowView): boolean {
  const titles = TitlesDataSchema.safeParse(run.titlesData);
  const hooks = HookDataSchema.safeParse(run.hookData);
  return (
    titles.success &&
    hasAnyLockedTitle(titles.data) &&
    hooks.success &&
    hooks.data.lockedVariantIndex !== null
  );
}

export function Stage7Card({ run, cardState }: Stage7CardProps) {
  const persisted = useMemo(() => parseScript(run.scriptData), [run.scriptData]);
  const stream = useScriptStream();

  // Prefer the persisted run row; fall back to the just-streamed result so the
  // full view appears the instant streaming finishes (before the bus refresh).
  const data = persisted ?? stream.result;
  if (data) {
    return <ScriptView data={data} stale={cardState === "stale"} runId={run.id} />;
  }

  if (stream.state === "streaming") {
    return <StreamingView stream={stream} />;
  }

  if (!prereqsMet(run)) {
    return (
      <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
        <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
          7
        </span>
        <p className="text-sm font-semibold text-white">
          7 · Retention script
          <span className="text-xs font-normal text-ink-400 ml-1">
            · lock a title + hook first
          </span>
        </p>
      </li>
    );
  }

  return <LengthGate runId={run.id} stream={stream} />;
}

function LengthGate({
  runId,
  stream,
}: {
  runId: string;
  stream: ReturnType<typeof useScriptStream>;
}) {
  const [minutes, setMinutes] = useState<ScriptTargetMinutes>(8);
  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill="Stage 7 · Ready"
        pillClass="bg-yt-600/15 text-yt-400 ring-1 ring-yt-600/30"
        subtitle="Pick a length, then stream the retention script (Opus 4.7)."
      />
      {stream.state === "error" && (
        <div className="mt-3 rounded-md bg-fear-500/[0.06] ring-1 ring-fear-500/20 p-3 text-[11px] text-fear-500">
          {stream.errorCode === "BUDGET_EXCEEDED"
            ? "We're temporarily over capacity. Try again at midnight UTC."
            : stream.errorCode === "RATE_LIMITED"
              ? "Daily script limit reached for this channel."
              : stream.errorCode === "FORMAT_VIOLATION"
                ? "The model couldn't produce a valid script. Try again."
                : `Generation failed (${stream.errorCode}).`}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        {SCRIPT_TARGET_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMinutes(m)}
            className={`text-xs px-3 py-1.5 rounded-md ring-1 transition ${
              minutes === m
                ? "bg-yt-600/15 text-yt-400 ring-yt-600/40"
                : "bg-white/5 text-ink-300 ring-white/10 hover:bg-white/10"
            }`}
          >
            {m} min
          </button>
        ))}
        <button
          type="button"
          onClick={() => stream.start(runId, minutes)}
          className="btn-primary ml-auto text-sm px-4 py-2 rounded-lg text-white font-semibold"
        >
          Generate script →
        </button>
      </div>
    </li>
  );
}

function StreamingView({
  stream,
}: {
  stream: ReturnType<typeof useScriptStream>;
}) {
  return (
    <li className="card rounded-2xl p-5">
      <StageHeader
        pill="Stage 7 · Streaming"
        pillClass="bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30"
        subtitle={stream.progressMessage ?? "Generating…"}
      />
      <div className="mt-4 space-y-3">
        {stream.chunks.map((c) => (
          <div
            key={c.sectionIndex}
            className="rounded-lg ring-1 ring-white/5 p-3 bg-white/[0.02]"
          >
            <p className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
              Section {c.sectionIndex}
            </p>
            <p className="text-xs text-ink-200 whitespace-pre-wrap leading-relaxed">
              {c.text}
              <span className="inline-block w-1.5 h-3 bg-blue-400 ml-0.5 align-middle pulse-dot" />
            </p>
          </div>
        ))}
        {stream.chunks.length === 0 && (
          <p className="text-xs text-ink-400">{stream.progressMessage}</p>
        )}
      </div>
    </li>
  );
}
