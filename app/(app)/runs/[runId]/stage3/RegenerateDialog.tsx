"use client";

import { useState } from "react";

import type { CompetitorData } from "@/lib/validation/competitor";

export function RegenerateButton({
  runId,
  cached,
}: {
  runId: string;
  cached: CompetitorData | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white transition"
      >
        Regenerate
      </button>
      {open && (
        <RegenerateDialog
          runId={runId}
          cached={cached}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RegenerateDialog({
  runId,
  cached,
  onClose,
}: {
  runId: string;
  cached: CompetitorData | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"forceFresh" | "reExtractOnly">(
    cached ? "reExtractOnly" : "forceFresh",
  );
  const [submitting, setSubmitting] = useState(false);
  const recentlyCached =
    cached &&
    Date.now() - new Date(cached.cachedAt).getTime() < 5 * 60 * 1000;

  async function submit() {
    setSubmitting(true);
    try {
      await fetch("/api/pipeline/competitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          forceFresh: mode === "forceFresh",
          reExtractOnly: mode === "reExtractOnly",
        }),
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
        className="card rounded-2xl p-5 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-extrabold text-white">
          Regenerate outliers?
        </h3>
        <p className="text-xs text-ink-400 mt-1">
          {recentlyCached
            ? "Your cache is fresh — re-fetching is unlikely to change much."
            : "Pick how you want to refresh the outlier set."}
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-3 p-3 rounded-lg card-row cursor-pointer">
            <input
              type="radio"
              name="regen-mode"
              checked={mode === "forceFresh"}
              onChange={() => setMode("forceFresh")}
              className="mt-0.5"
            />
            <div className="text-xs">
              <p className="font-semibold text-white">Force fresh fetch</p>
              <p className="text-ink-400 mt-0.5">
                Re-query YouTube + re-run Opus delta extraction.{" "}
                <span className="text-amber-300">~500 YouTube units</span> ·
                ~$0.10 Opus
              </p>
            </div>
          </label>
          <label
            className={`flex items-start gap-3 p-3 rounded-lg card-row cursor-pointer ${cached ? "" : "opacity-50 cursor-not-allowed"}`}
          >
            <input
              type="radio"
              name="regen-mode"
              checked={mode === "reExtractOnly"}
              onChange={() => setMode("reExtractOnly")}
              disabled={!cached}
              className="mt-0.5"
            />
            <div className="text-xs">
              <p className="font-semibold text-white">
                Re-run delta extraction only
              </p>
              <p className="text-ink-400 mt-0.5">
                Reuse cached YouTube data, only re-run Opus.{" "}
                <span className="text-emerald-400">0 YouTube units</span> ·
                ~$0.10 Opus
              </p>
            </div>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
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
            {submitting ? "Starting…" : "Regenerate now"}
          </button>
        </div>
      </div>
    </div>
  );
}
