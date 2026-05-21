"use client";

import { useMemo } from "react";

import type { RunRowView } from "@/lib/validation/runs";
import { SeoDataSchema, type SeoData } from "@/lib/validation/seo";
import { useSeo } from "@/lib/hooks/useSeo";

import type { StageCardState } from "./StageCard";
import {
  ChaptersSection,
  DescriptionSection,
  EndScreenSection,
  HashtagsSection,
  PinnedSection,
  TagsSection,
} from "./stage10/Sections";
import { SeoHeaderPill } from "./stage10/shared";

export type Stage10CardProps = {
  run: RunRowView;
  cardState: StageCardState;
  progressMessage: string | null;
  errorCode: string | null;
};

function tryParse(payload: unknown): SeoData | null {
  if (payload === null || payload === undefined) return null;
  const parsed = SeoDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function Stage10Card({ run, cardState, progressMessage, errorCode }: Stage10CardProps) {
  const data = useMemo(() => tryParse(run.seoData), [run.seoData]);

  if (cardState === "running") {
    return (
      <li className="card rounded-2xl p-5">
        <Header pill={<SeoHeaderPill text="Building…" tone="warn" />} />
        <p className="text-xs text-ink-400 mt-3">{progressMessage ?? "Building the SEO pack…"}</p>
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-white/[0.025] ring-1 ring-white/5 animate-pulse" />
          ))}
        </div>
      </li>
    );
  }

  if (data) return <SeoView data={data} runId={run.id} />;

  if (run.titlesData === null || run.scriptData === null) {
    return <Pending label="Lock a title and generate a script first." />;
  }
  return <ReadyCard runId={run.id} errorCode={errorCode} />;
}

function SeoView({ data, runId }: { data: SeoData; runId: string }) {
  const seo = useSeo(runId);
  const regen = (section: Parameters<typeof seo.regenerate>[0]) => ({
    regenerating: seo.pending.has(section),
    onRegenerate: () => seo.regenerate(section),
  });

  return (
    <li className="space-y-4">
      <div className="card rounded-2xl p-5">
        <Header
          pill={<SeoHeaderPill text="Generated" tone="ok" />}
          right={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-ink-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={data.flags.sponsoredDisclosure}
                  disabled={seo.busy}
                  onChange={async (e) => {
                    await seo.toggleSponsored(e.target.checked);
                    await seo.regenerate("description");
                  }}
                />
                Sponsored
              </label>
              <button
                type="button"
                disabled={seo.busy}
                onClick={() => seo.copyAll()}
                className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
              >
                {seo.busy ? "…" : "Copy all"}
              </button>
            </div>
          }
        />
        <p className="text-xs text-ink-400 mt-1">
          Copy-paste ready for YouTube Studio. Built from your title and script.
        </p>
        {data.flags.sponsoredDisclosure && (
          <p className="mt-3 rounded-md bg-amber-500/[0.06] ring-1 ring-amber-500/20 p-2.5 text-[11px] text-amber-200">
            FTC paid-promotion disclosure inserted at the top of the description. Also toggle &quot;Includes paid promotion&quot; in Studio.
          </p>
        )}
        {seo.error && <p className="mt-2 text-xs text-rose-300/80 font-mono">{seo.error}</p>}
      </div>

      <DescriptionSection desc={data.description} flags={data.flags} {...regen("description")} />
      <TagsSection tags={data.tags} flags={data.flags} {...regen("tags")} />
      <HashtagsSection hashtags={data.hashtags} {...regen("hashtags")} />
      <ChaptersSection chapters={data.chapters} flags={data.flags} {...regen("chapters")} />
      <EndScreenSection endScreen={data.endScreenSuggestions} flags={data.flags} {...regen("endScreen")} />
      <PinnedSection pinned={data.pinnedCommentDraft} {...regen("pinnedComment")} />
    </li>
  );
}

function Header({ pill, right }: { pill: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-base font-extrabold tracking-tight text-white">
        SEO Metadata Pack <span className="ml-1">{pill}</span>
      </h2>
      {right}
    </div>
  );
}

function ReadyCard({ runId, errorCode }: { runId: string; errorCode: string | null }) {
  const seo = useSeo(runId);
  return (
    <li className="card rounded-2xl p-5">
      <Header pill={<SeoHeaderPill text={errorCode ? "Failed" : "Ready"} tone={errorCode ? "err" : "ok"} />} />
      <p className="text-xs text-ink-400 mt-1">
        {errorCode ? "Couldn't build the SEO pack — retry." : "Description, tags, hashtags, chapters, end screen, pinned comment."}
      </p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={seo.busy}
          onClick={() => seo.runSeo()}
          className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50"
        >
          {seo.busy ? "Starting…" : errorCode ? "Retry" : "Generate SEO pack"}
        </button>
      </div>
    </li>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <li className="card-row rounded-xl px-4 py-3 flex items-center gap-3 opacity-60">
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 bg-white/10 text-ink-400 ring-white/10">
        10
      </span>
      <p className="text-sm font-semibold text-white">
        10 · SEO metadata
        <span className="text-xs font-normal text-ink-400 ml-1">· {label}</span>
      </p>
    </li>
  );
}
