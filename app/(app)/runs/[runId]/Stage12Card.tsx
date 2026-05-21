"use client";

import { useMemo } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { EngagementDraftsSchema, type EngagementDrafts } from "@/lib/validation/engagement";
import { useEngagement } from "@/lib/hooks/useEngagement";

import type { StageCardState } from "./StageCard";
import { DraftCard, RepliesPanel, ShipItCapstone } from "./stage12/parts";

export type Stage12CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
  errorCode: string | null;
};

const PINNED = "bg-violet-500/15 text-violet-300 ring-violet-500/30";
const PRE = "bg-curiosity-500/15 text-curiosity-500 ring-curiosity-500/35";
const POST = "bg-result-500/15 text-result-500 ring-result-500/35";

function tryParse(payload: unknown): EngagementDrafts | null {
  if (payload === null || payload === undefined) return null;
  const parsed = EngagementDraftsSchema.safeParse(payload);
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

export function Stage12Card({ run, cardState, progressMessage, errorCode }: Stage12CardProps) {
  const data = useMemo(() => tryParse(run.engagementDraftsData), [run.engagementDraftsData]);

  if (cardState === "running") {
    return (
      <li className="card rounded-2xl p-5">
        <h2 className="text-base font-extrabold tracking-tight text-white">
          Engagement Drafts <Pill text="Drafting…" tone="warn" />
        </h2>
        <p className="text-xs text-ink-400 mt-3">{progressMessage ?? "Drafting engagement copy…"}</p>
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-white/[0.025] ring-1 ring-white/5 animate-pulse" />
          ))}
        </div>
      </li>
    );
  }

  if (data) return <DraftsView data={data} runId={run.id} complete={run.status === "complete"} />;

  if (run.titlesData === null || run.scriptData === null) {
    return <Pending label="Generate a title and script first." />;
  }
  return <ReadyCard runId={run.id} errorCode={errorCode} />;
}

function DraftsView({ data, runId, complete }: { data: EngagementDrafts; runId: string; complete: boolean }) {
  const eng = useEngagement(runId);
  return (
    <li className="space-y-4">
      <div className="card rounded-2xl p-5">
        <h2 className="text-base font-extrabold tracking-tight text-white">
          Engagement Drafts <Pill text="Drafts ready" tone="ok" />
        </h2>
        <p className="text-xs text-ink-400 mt-1">
          Pinned comment + community posts to extend engagement beyond the video.
        </p>
        {eng.error && <p className="mt-2 text-xs text-rose-300/80 font-mono">{eng.error}</p>}
      </div>

      {complete && <ShipItCapstone data={data} onDownload={eng.downloadBundle} />}

      <DraftCard
        label="Pinned comment"
        accent={PINNED}
        text={data.pinnedComment.text}
        badges={data.pinnedComment.lintBadges}
        pending={eng.pending.has("pinned")}
        onRegenerate={() => eng.regenerate("pinned")}
      />
      <DraftCard
        label="Community · pre-publish"
        accent={PRE}
        text={data.communityPostPrePublish.text}
        badges={data.communityPostPrePublish.badges}
        poll={data.communityPostPrePublish.poll}
        pending={eng.pending.has("pre")}
        onRegenerate={() => eng.regenerate("pre")}
      />
      <DraftCard
        label="Community · post-publish"
        accent={POST}
        text={data.communityPostPostPublish.text}
        badges={data.communityPostPostPublish.badges}
        pending={eng.pending.has("post")}
        onRegenerate={() => eng.regenerate("post")}
      />
      <RepliesPanel
        replies={data.suggestedReplyTemplates}
        pending={eng.pending.has("replies")}
        onRegenerate={() => eng.regenerate("replies")}
      />
    </li>
  );
}

function ReadyCard({ runId, errorCode }: { runId: string; errorCode: string | null }) {
  const eng = useEngagement(runId);
  const lintExhausted = errorCode === "LINT_RETRIES_EXHAUSTED";
  return (
    <li className="card rounded-2xl p-5">
      <h2 className="text-base font-extrabold tracking-tight text-white">
        Engagement Drafts <Pill text={errorCode ? "Failed" : "Ready"} tone={errorCode ? "err" : "ok"} />
      </h2>
      <p className="text-xs text-ink-400 mt-1">
        {lintExhausted
          ? "The model kept tripping the engagement lint — retry or edit manually."
          : errorCode
            ? "Couldn't draft the engagement copy — retry."
            : "Pinned comment + community posts + suggested replies. The final stage."}
      </p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={eng.busy}
          onClick={() => eng.runEngagement()}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
        >
          {eng.busy ? "Starting…" : errorCode ? "Retry" : "Draft engagement copy"}
        </button>
      </div>
    </li>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        12
      </span>
      <p className="text-sm font-semibold text-white">
        12 · Pinned + community
        <span className="text-xs font-normal text-ink-400 ml-1">· {label}</span>
      </p>
    </li>
  );
}
