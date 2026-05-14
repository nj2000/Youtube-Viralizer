"use client";

import { useEffect, useState } from "react";

export function DeleteChannelModal({
  channelId,
  channelTitle,
  onClose,
  onDeleted,
}: {
  channelId: string;
  channelTitle: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [runCount, setRunCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/channels/${channelId}/run-count`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to fetch run count");
        const data: { runCount: number } = await res.json();
        if (!cancelled) setRunCount(data.runCount);
      } catch {
        if (!cancelled) setRunCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Couldn't delete this channel. Please try again.");
        setSubmitting(false);
        return;
      }
      onDeleted();
    } catch {
      setError("Couldn't delete this channel. Please try again.");
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
        <h2 className="text-lg font-extrabold text-white">
          Remove {channelTitle}?
        </h2>
        <p className="mt-2 text-sm text-ink-300">
          This channel and all generated kits will be hidden. You can re-add
          the channel later by pasting its URL again.
        </p>
        {runCount !== null && runCount > 0 && (
          <p className="mt-3 text-sm text-amber-300/90">
            {runCount} pipeline run{runCount === 1 ? "" : "s"} will also be
            removed from your workspace.
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm text-rose-400">{error}</p>
        )}
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
            disabled={submitting || runCount === null}
            className="px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 ring-1 ring-rose-500/40 text-rose-300 font-semibold rounded-lg transition text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Removing…" : "Remove channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
