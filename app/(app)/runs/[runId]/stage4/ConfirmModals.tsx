"use client";

import { useState } from "react";

import type { Reframe } from "@/lib/validation/score";

export function ReframeConfirmModal({
  runId,
  reframeIndex,
  reframe,
  ideaText,
  onClose,
}: {
  runId: string;
  reframeIndex: number;
  reframe: Reframe;
  ideaText: string;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    setSubmitting(true);
    try {
      await fetch(`/api/runs/${runId}/apply-reframe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reframeIndex }),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card rounded-2xl p-6 max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-extrabold text-curiosity-500">
          Confirm reframe
        </h3>
        <p className="text-xs text-ink-400 mt-1">
          Replace your idea and re-run?
        </p>
        <div className="mt-4 rounded-lg p-3 bg-fear-500/[0.04] ring-1 ring-fear-500/15">
          <p className="text-[10px] uppercase tracking-wider text-fear-500/80">
            Current idea
          </p>
          <p className="mt-1 text-xs text-ink-300 line-through">{ideaText}</p>
        </div>
        <div className="mt-2 text-center text-ink-400">↓</div>
        <div className="mt-2 rounded-lg p-3 bg-result-500/[0.06] ring-1 ring-result-500/20">
          <p className="text-[10px] uppercase tracking-wider text-result-500">
            Replace with
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {reframe.revisedIdeaText}
          </p>
        </div>
        <p className="mt-4 text-[11px] text-ink-400">
          Re-runs from stage 3 (competitor outliers). Cached YouTube data is
          reused — no quota cost. Estimated time: ~25 seconds.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="btn-primary text-xs px-3 py-1.5 rounded-md text-white font-semibold disabled:opacity-60"
          >
            {submitting ? "Applying…" : "Replace and re-run"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OverrideConfirmModal({
  runId,
  finalScore,
  onClose,
}: {
  runId: string;
  finalScore: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    setSubmitting(true);
    try {
      await fetch(`/api/runs/${runId}/override-gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card rounded-2xl p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-extrabold text-amber-300">
          Override the 92-point gate?
        </h3>
        <p className="text-xs text-ink-400 mt-1">
          This run scored {Math.round(finalScore)}/100. Downstream stages will
          run anyway, but titles, hooks, and scripts will be flagged with the
          override badge.
        </p>
        <label className="block mt-4 text-[11px] uppercase tracking-wider text-ink-400">
          Reason (optional, ≤500 chars)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          rows={3}
          className="input mt-2 w-full rounded-md px-3 py-2 text-sm"
          placeholder="e.g. testing a non-niche topic for personal use"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="text-xs px-3 py-1.5 rounded-md ring-1 ring-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-semibold disabled:opacity-60"
          >
            {submitting ? "Overriding…" : "Override and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
