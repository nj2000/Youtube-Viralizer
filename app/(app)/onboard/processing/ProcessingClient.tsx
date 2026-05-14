"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useStageStream } from "@/lib/hooks/useStageStream";
import type { ChannelDraft } from "@/lib/validation/onboard";

type Step = {
  id:
    | "validating"
    | "fetching_channel"
    | "fetching_videos"
    | "computing_median"
    | "extracting_niche"
    | "identifying_competitors";
  title: string;
  detail?: string;
};

const STEP_ORDER: Step["id"][] = [
  "validating",
  "fetching_channel",
  "fetching_videos",
  "computing_median",
  "extracting_niche",
  "identifying_competitors",
];

const STEP_TITLES: Record<Step["id"], string> = {
  validating: "Validating URL",
  fetching_channel: "Fetching channel data",
  fetching_videos: "Analyzing your last 50 videos",
  computing_median: "Computing median view count",
  extracting_niche: "Extracting niche",
  identifying_competitors: "Identifying competitors",
};

type OnboardProgress = {
  step: Step["id"];
  status: "ok";
  channel?: {
    title: string;
    handle: string | null;
    subscriberCount: number | null;
  };
  videoCount?: number;
  medianViews?: number | null;
  niche?: string;
  failed?: boolean;
  competitorCount?: number;
};

function progressDetail(event: OnboardProgress): string | null {
  switch (event.step) {
    case "validating":
      return "URL parsed";
    case "fetching_channel":
      if (event.channel) {
        const subs = event.channel.subscriberCount?.toLocaleString();
        const handle = event.channel.handle ? `@${event.channel.handle} · ` : "";
        return `${handle}${subs ? `${subs} subscribers` : "metadata loaded"}`;
      }
      return null;
    case "fetching_videos":
      return event.videoCount !== undefined
        ? `${event.videoCount} recent video${event.videoCount === 1 ? "" : "s"}`
        : null;
    case "computing_median":
      return event.medianViews !== undefined && event.medianViews !== null
        ? `${event.medianViews.toLocaleString()} median views`
        : event.medianViews === null
          ? "New channel — no median yet"
          : null;
    case "extracting_niche":
      if (event.failed) return "Couldn't auto-detect — you can edit on review";
      return event.niche ? `"${event.niche.slice(0, 60)}${event.niche.length > 60 ? "…" : ""}"` : null;
    case "identifying_competitors":
      return event.competitorCount !== undefined
        ? `${event.competitorCount} found`
        : null;
  }
}

export function ProcessingClient({ url }: { url: string }) {
  const router = useRouter();
  const { state, progress, result, error, start } = useStageStream<
    OnboardProgress,
    ChannelDraft
  >("/api/onboard");

  useEffect(() => {
    void start({ url });
  }, [start, url]);

  useEffect(() => {
    if (state === "done" && result?.draftId) {
      router.replace(`/onboard/review?draftId=${result.draftId}`);
    }
  }, [state, result, router]);

  useEffect(() => {
    if (state === "error" && error) {
      router.replace(`/onboard?error=${encodeURIComponent(error.code)}`);
    }
  }, [state, error, router]);

  const completedSteps = new Set(progress.map((e) => e.step));
  const currentStep =
    state === "running"
      ? STEP_ORDER.find((s) => !completedSteps.has(s)) ?? null
      : null;

  return (
    <div className="card rounded-2xl px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-extrabold text-white">
          Setting up your channel
        </h1>
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yt-600/15 text-yt-400 text-xs font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-yt-500 pulse-dot" />
          processing
        </span>
      </div>
      <p className="text-ink-300 text-sm mb-6">
        Analyzing your last 50 videos to ground every kit.
      </p>

      <ul className="space-y-3">
        {STEP_ORDER.map((step, index) => {
          const completedEvent = progress.find((e) => e.step === step);
          const isCompleted = Boolean(completedEvent);
          const isCurrent = currentStep === step;
          const isPending = !isCompleted && !isCurrent;

          return (
            <li
              key={step}
              className={`flex items-start gap-3 rounded-lg p-3 ${
                isPending ? "opacity-50" : ""
              }`}
            >
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ring-1 shrink-0 ${
                  isCompleted
                    ? "bg-emerald-500/15 ring-emerald-500/30 text-emerald-400"
                    : isCurrent
                      ? "bg-yt-600/15 ring-yt-600/40 text-yt-400"
                      : "bg-white/5 ring-white/10 text-ink-400"
                }`}
              >
                {isCompleted ? (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                ) : isCurrent ? (
                  <svg
                    className="h-3.5 w-3.5 spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-white">
                  {STEP_TITLES[step]}
                </span>
                {completedEvent && (
                  <span className="block text-xs text-ink-400 mt-0.5">
                    {progressDetail(completedEvent)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
