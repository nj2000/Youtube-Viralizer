"use client";

import { useState } from "react";
import Link from "next/link";

import { useRunsList } from "@/lib/hooks/useRunsList";
import type { RunStatus } from "@/lib/validation/runs";

import { RunRow } from "./RunRow";
import { DeleteRunModal } from "./DeleteRunModal";

const STATUS_FILTERS: Array<{ key: "all" | RunStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "complete", label: "Complete" },
  { key: "running", label: "Running" },
  { key: "gated_failed", label: "Gated" },
  { key: "error", label: "Errored" },
];

export function RunsList({ channelTitle }: { channelTitle: string }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RunStatus>("all");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    ideaText: string;
  } | null>(null);

  const { data, loading, error, refresh } = useRunsList({
    q: q.trim() || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
  });

  const totalRuns = data?.counts.all ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Runs
          </h1>
          <p className="text-sm text-ink-300 mt-1">
            Every kit you&apos;ve generated for{" "}
            <span className="text-white font-semibold">{channelTitle}</span>
            {totalRuns > 0 ? ` · ${totalRuns} runs total` : ""}
          </p>
        </div>
        <Link
          href="/runs/new"
          className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold text-white flex items-center gap-2"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          Drop new idea
        </Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-6">
        <input
          type="search"
          placeholder="Search idea text…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="input rounded-lg px-3 py-2 text-sm flex-1 min-w-[280px]"
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((filter) => {
            const isActive = statusFilter === filter.key;
            const count = data?.counts[filter.key] ?? 0;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setStatusFilter(filter.key);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ring-1 ${
                  isActive
                    ? "bg-white/10 ring-white/15 text-white"
                    : "bg-white/[0.03] ring-white/5 text-ink-300 hover:bg-white/5"
                }`}
              >
                {filter.label} · {count}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          className="rounded-xl p-4 mb-6"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          <p className="text-sm text-rose-300">{error.message}</p>
        </div>
      )}

      {loading && !data ? (
        <div className="card rounded-2xl p-10 text-center text-ink-400 text-sm">
          Loading runs…
        </div>
      ) : data && data.runs.length === 0 ? (
        <EmptyState hasFilters={Boolean(q || statusFilter !== "all")} />
      ) : (
        <ul className="space-y-2.5">
          {data?.runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onDelete={() =>
                setDeleteTarget({ id: run.id, ideaText: run.ideaText })
              }
            />
          ))}
        </ul>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between mt-6 text-sm">
          <p className="text-ink-400">
            Showing {(data.page - 1) * data.pageSize + 1}–
            {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-md ring-1 ring-white/10 text-ink-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-white">{page}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-md ring-1 ring-white/10 text-ink-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <DeleteRunModal
          runId={deleteTarget.id}
          ideaText={deleteTarget.ideaText}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  if (hasFilters) {
    return (
      <div className="rounded-2xl p-10 text-center border border-dashed border-white/10">
        <h2 className="text-lg font-extrabold text-white">
          No runs match these filters
        </h2>
        <p className="text-sm text-ink-300 mt-2">
          Try clearing filters or running a fresh idea.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl p-10 text-center border border-dashed border-white/10">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-b from-yt-500 to-yt-700 shadow-glow-yt mx-auto flex items-center justify-center mb-4">
        <svg
          className="h-7 w-7 text-white"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <h2 className="text-xl font-extrabold text-white">
        Drop your first idea
      </h2>
      <p className="text-sm text-ink-300 mt-2 max-w-md mx-auto">
        A sentence is enough. We&apos;ll run all 12 stages — outliers, score,
        titles, hook, full script, thumbnails, SEO — and you&apos;ll have a
        complete kit in about 90 seconds.
      </p>
      <Link
        href="/runs/new"
        className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold text-white inline-flex items-center gap-2 mt-5"
      >
        Drop a video idea
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
      </Link>
    </div>
  );
}
