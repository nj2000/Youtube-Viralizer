"use client";

import { useState } from "react";

export function DeleteRunModal({
  runId,
  ideaText,
  onClose,
  onDeleted,
}: {
  runId: string;
  ideaText: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete this run. Please try again.");
        setSubmitting(false);
        return;
      }
      onDeleted();
    } catch {
      setError("Couldn't delete this run. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card rounded-2xl p-6 w-full max-w-md"
        style={{ background: "#13131a" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="h-9 w-9 rounded-full bg-rose-500/15 ring-1 ring-rose-500/30 flex items-center justify-center text-rose-400">
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </span>
          <h2 className="text-lg font-extrabold text-white">Delete this run?</h2>
        </div>
        <p className="text-sm text-ink-300">
          <span className="text-white font-medium">
            &ldquo;
            {ideaText.length > 80 ? `${ideaText.slice(0, 80)}…` : ideaText}
            &rdquo;
          </span>{" "}
          and all 12 stage outputs (titles, hook, script, thumbnails, SEO, A/B
          plan) will be permanently deleted.
        </p>
        <p className="text-sm text-rose-300 mt-3">
          This can&apos;t be undone — there&apos;s no trash bin in v1.
        </p>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white font-semibold rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 ring-1 ring-rose-500/40 text-rose-300 font-semibold rounded-lg transition text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
