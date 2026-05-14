"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ChannelDraft } from "@/lib/validation/onboard";
import type { Competitor } from "@/lib/validation/channels";

import { CompetitorList } from "./CompetitorList";
import { AddCompetitorInput } from "./AddCompetitorInput";

const NICHE_MAX = 200;
const COMPETITOR_MIN_FOR_PROCEED = 3;

export function ReviewClient({ draft }: { draft: ChannelDraft }) {
  const router = useRouter();
  const [niche, setNiche] = useState(draft.niche);
  const [competitors, setCompetitors] = useState<Competitor[]>(draft.competitors);
  const [redetecting, setRedetecting] = useState(false);
  const [redetectError, setRedetectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [acknowledgedNoCompetitors, setAcknowledgedNoCompetitors] =
    useState(false);

  const subscriberLabel = useMemo(() => {
    if (draft.subscriberCount === null) return "subscribers hidden";
    return `${draft.subscriberCount.toLocaleString()} subs`;
  }, [draft.subscriberCount]);

  const medianLabel = useMemo(() => {
    if (draft.medianViews === null) return "new channel";
    return `${draft.medianViews.toLocaleString()} median views`;
  }, [draft.medianViews]);

  const nicheEmpty = niche.trim().length === 0;
  const competitorsBelowThreshold =
    competitors.length < COMPETITOR_MIN_FOR_PROCEED;
  const confirmDisabled =
    submitting ||
    nicheEmpty ||
    (competitorsBelowThreshold && !acknowledgedNoCompetitors);

  async function handleRedetect() {
    setRedetecting(true);
    setRedetectError(null);
    try {
      const res = await fetch("/api/competitors/redetect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          currentChannelHandle: draft.handle,
          draftId: draft.draftId,
        }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          setRedetectError(
            "Re-detect is available once per hour. Try again shortly.",
          );
        } else {
          setRedetectError("Couldn't re-detect competitors right now.");
        }
        return;
      }
      const data: { competitors: Competitor[] } = await res.json();
      const manualKept = competitors.filter((c) => c.source === "manual");
      const merged = [
        ...data.competitors,
        ...manualKept.filter(
          (m) =>
            !data.competitors.some(
              (c) => c.youtubeChannelId === m.youtubeChannelId,
            ),
        ),
      ].slice(0, 20);
      setCompetitors(merged);
    } catch {
      setRedetectError("Couldn't re-detect competitors right now.");
    } finally {
      setRedetecting(false);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/onboard/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.draftId,
          niche: niche.trim(),
          competitors,
        }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          setSubmitError(
            "This draft expired. Re-enter your channel URL to start over.",
          );
        } else if (res.status === 403) {
          setSubmitError("You've reached the 3-channel limit.");
        } else {
          setSubmitError("Couldn't save the channel. Please try again.");
        }
        return;
      }
      router.replace("/runs/new");
    } catch {
      setSubmitError("Couldn't save the channel. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          Review your channel
        </h1>
        <p className="text-ink-300 mt-2 text-sm">
          {competitorsBelowThreshold
            ? "We need a couple competitors before we can find outliers in your niche."
            : "Make sure we got this right. You can edit anything below."}
        </p>
      </div>

      <section className="card rounded-2xl p-5 flex items-center gap-4">
        <span className="h-12 w-12 rounded-2xl bg-gradient-to-br from-yt-500 to-orange-500 flex items-center justify-center text-white text-lg font-extrabold shrink-0">
          {draft.title.charAt(0).toUpperCase() || "C"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-extrabold text-white truncate">
              {draft.title}
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yt-600/15 text-yt-400 text-[10px] font-bold uppercase tracking-wider">
              your channel
            </span>
          </div>
          <p className="text-xs text-ink-400 truncate mt-0.5">
            {draft.handle ? `@${draft.handle}` : draft.youtubeChannelId}
          </p>
          <p className="text-xs text-ink-400 mt-1">
            {subscriberLabel} · {medianLabel} · {draft.topVideos.length} videos
          </p>
        </div>
      </section>

      <section className="card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="niche" className="text-sm font-semibold text-white">
            Detected niche
          </label>
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-400">
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 20 9-9" />
              <path d="M18 14V4H8" />
            </svg>
            Editable
          </span>
        </div>
        {draft.flags.nicheExtractionFailed && (
          <p className="text-xs text-amber-300 mb-2">
            We couldn&apos;t auto-detect your niche. Please describe it briefly.
          </p>
        )}
        <textarea
          id="niche"
          rows={3}
          maxLength={NICHE_MAX}
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          className="input w-full rounded-lg px-4 py-3 text-sm resize-none"
          placeholder="e.g. AI productivity tutorials for solo founders"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-ink-400">
            Used as the matching signal for outliers and titles.
          </p>
          <p className="text-xs text-ink-500 font-mono">
            {niche.length} / {NICHE_MAX}
          </p>
        </div>
      </section>

      <section className="card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">
            Competitors we&apos;ll track
          </h3>
          <button
            type="button"
            onClick={handleRedetect}
            disabled={redetecting || nicheEmpty}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <svg
              className={`h-3.5 w-3.5 ${redetecting ? "spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
            Re-detect
          </button>
        </div>
        <p className="text-xs text-ink-400 mb-3">
          Outliers from these channels feed every kit you generate.
        </p>
        {redetectError && (
          <p className="text-xs text-rose-400 mb-3">{redetectError}</p>
        )}
        <CompetitorList competitors={competitors} onChange={setCompetitors} />
        <AddCompetitorInput
          existing={competitors}
          onAdd={(c) => setCompetitors([...competitors, c].slice(0, 20))}
        />
        {competitorsBelowThreshold && (
          <div className="mt-4 rounded-lg p-3 bg-amber-500/10 ring-1 ring-amber-500/20 text-xs text-amber-200">
            <p className="font-medium">
              Add at least 3 competitors for useful outlier signal.
            </p>
            <label className="mt-2 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledgedNoCompetitors}
                onChange={(e) =>
                  setAcknowledgedNoCompetitors(e.target.checked)
                }
              />
              <span>
                I understand. Continue without enough competitors — I&apos;ll add
                them later from the channel switcher.
              </span>
            </label>
          </div>
        )}
      </section>

      {submitError && (
        <p className="text-sm text-rose-400 text-center">{submitError}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/onboard"
          className="text-sm text-ink-400 hover:text-ink-200 transition"
        >
          ← Re-enter URL
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="btn-primary rounded-lg px-5 py-3 text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Saving…" : "Confirm and continue"}
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
