"use client";

import type {
  Chapters,
  Description,
  EndScreenSuggestions,
  Hashtags,
  PinnedCommentDraft,
  SeoData,
  Tags,
} from "@/lib/validation/seo";

import { CopyButton, mmss, SectionShell } from "./shared";

type Flags = SeoData["flags"];
type RegenProps = { regenerating: boolean; onRegenerate: () => void };

export function DescriptionSection({
  desc,
  flags,
  ...r
}: { desc: Description; flags: Flags } & RegenProps) {
  return (
    <SectionShell
      title="Description"
      subtitle={
        flags.descriptionTruncated
          ? "Truncated at a sentence boundary to fit 5,000 chars"
          : "Hook · body · links · hashtags below"
      }
      warn={flags.descriptionTruncated}
      count={`${desc.body.length} / 5000`}
      copyText={desc.body}
      {...r}
    >
      <p className="text-[10px] uppercase tracking-wider text-ink-400">
        Above-fold preview · first 2 lines
      </p>
      <p className="mt-1 rounded-lg bg-ink-900/60 ring-1 ring-white/5 p-3 text-sm text-ink-100">
        {desc.aboveFold}
      </p>
      <p className="mt-3 rounded-lg bg-ink-900/60 ring-1 ring-white/5 p-3 text-sm text-ink-200 leading-relaxed whitespace-pre-line max-h-72 overflow-y-auto">
        {desc.body}
      </p>
      <p className="mt-2 text-[11px] text-ink-400">{desc.wordCount} words</p>
    </SectionShell>
  );
}

export function TagsSection({
  tags,
  flags,
  ...r
}: { tags: Tags; flags: Flags } & RegenProps) {
  return (
    <SectionShell
      title="Tags"
      subtitle={flags.tagsTrimmed ? "Trimmed by relevance to fit 500 chars" : `${tags.length} intent-phrase tags`}
      warn={flags.tagsTrimmed}
      count={`${tags.join(",").length} / 500`}
      copyText={tags.join(", ")}
      {...r}
    >
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="rounded-full px-3 py-1.5 text-xs text-ink-100 bg-white/5 ring-1 ring-white/10">
            {t}
          </span>
        ))}
      </div>
      {flags.tagsTrimmedList.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          Trimmed: {flags.tagsTrimmedList.join(", ")}
        </p>
      )}
    </SectionShell>
  );
}

export function HashtagsSection({
  hashtags,
  ...r
}: { hashtags: Hashtags } & RegenProps) {
  return (
    <SectionShell
      title="Hashtags"
      subtitle="Top 3 above-title · plus optional list"
      copyText={[...hashtags.primary, ...hashtags.optional].join(" ")}
      {...r}
    >
      <div className="grid grid-cols-3 gap-3">
        {hashtags.primary.map((h, i) => (
          <div key={h} className="card-row rounded-lg p-3 text-center">
            <p className="text-base font-bold text-yt-400">{h}</p>
            <p className="text-[10px] text-ink-400 mt-1">
              {["topic anchor", "audience cluster", "vertical signal"][i]}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {hashtags.optional.map((h) => (
          <span key={h} className="rounded-full px-3 py-1 text-xs text-ink-200 bg-white/5 ring-1 ring-white/10">
            {h}
          </span>
        ))}
      </div>
    </SectionShell>
  );
}

export function ChaptersSection({
  chapters,
  flags,
  ...r
}: { chapters: Chapters; flags: Flags } & RegenProps) {
  const copyText = chapters.map((c) => `${mmss(c.timeSec)} ${c.label}`).join("\n");
  return (
    <SectionShell
      title="Chapters"
      subtitle={
        flags.chaptersFallback
          ? "Fallback structure (few script breaks) — adjust after recording"
          : `${chapters.length} chapters · deterministic from your script`
      }
      warn={flags.chaptersFallback}
      copyText={copyText}
      {...r}
    >
      <ul className="space-y-1.5 font-mono text-sm">
        {chapters.map((c, i) => (
          <li key={i} className="card-row flex items-center gap-3 rounded-lg px-3 py-2">
            <span className="text-yt-400 font-semibold w-12 shrink-0">{mmss(c.timeSec)}</span>
            <span className="text-ink-100">{c.label}</span>
            {i === 0 && (
              <span className="ml-auto text-[10px] text-ink-500 font-sans">required first chapter</span>
            )}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

export function EndScreenSection({
  endScreen,
  flags,
  ...r
}: { endScreen: EndScreenSuggestions; flags: Flags } & RegenProps) {
  const copyText = [
    ...endScreen.videos.map((v) => `${v.title} — ${v.reason}`),
    `Subscribe: ${endScreen.subscribePrompt.cta}`,
  ].join("\n");
  return (
    <SectionShell
      title="End-screen suggestions"
      subtitle={flags.endScreenSubscribeOnly ? "Subscribe-only · no prior videos to recommend" : `${endScreen.videos.length} video placements + subscribe`}
      copyText={copyText}
      {...r}
    >
      {endScreen.videos.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {endScreen.videos.map((v) => (
            <div key={v.videoId} className="card-row rounded-xl p-3">
              <span className="inline-flex h-5 px-1.5 items-center rounded text-[10px] font-semibold ring-1 bg-yt-600/15 text-yt-400 ring-yt-600/30">
                {v.affinityType === "most_watched" ? "MOST-WATCHED" : "HIGH-AFFINITY"}
              </span>
              <p className="text-sm font-semibold text-white mt-1.5 leading-snug">{v.title}</p>
              <p className="text-xs text-ink-200 mt-1.5 leading-relaxed">{v.reason}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 card-row rounded-xl p-3 text-sm text-ink-200">
        <span className="inline-flex h-5 px-1.5 items-center rounded text-[10px] font-semibold ring-1 bg-yt-600/15 text-yt-400 ring-yt-600/30">
          SUBSCRIBE · {endScreen.subscribePrompt.placement === "split" ? "SPLIT" : "FULL FRAME"}
        </span>
        <p className="mt-1.5">{endScreen.subscribePrompt.cta}</p>
      </div>
    </SectionShell>
  );
}

export function PinnedSection({
  pinned,
  ...r
}: { pinned: PinnedCommentDraft } & RegenProps) {
  return (
    <SectionShell
      title="Pinned comment draft"
      subtitle="Tiered CTA · free → mid → premium"
      copyText={pinned.body}
      {...r}
    >
      <p className="rounded-lg bg-ink-900/60 ring-1 ring-white/5 p-4 text-sm text-ink-200 leading-relaxed whitespace-pre-line">
        {pinned.body}
      </p>
    </SectionShell>
  );
}

export { CopyButton };
