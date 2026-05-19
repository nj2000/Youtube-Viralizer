"use client";

import Link from "next/link";

import type { RunListItem, RunStatus } from "@/lib/validation/runs";

const STATUS_STYLES: Record<
  RunStatus,
  {
    label: string;
    text: string;
    bg: string;
    ring: string;
  }
> = {
  queued: {
    label: "QUEUED",
    text: "text-ink-300",
    bg: "bg-white/5",
    ring: "ring-white/10",
  },
  running: {
    label: "RUNNING",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    ring: "ring-blue-500/20",
  },
  complete: {
    label: "COMPLETE",
    text: "text-yt-400",
    bg: "bg-yt-600/15",
    ring: "ring-yt-600/30",
  },
  gated_failed: {
    label: "GATED",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/20",
  },
  scored_overridden: {
    label: "OVERRIDDEN",
    text: "text-amber-300",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30",
  },
  error: {
    label: "ERROR",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/20",
  },
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function RunRow({
  run,
  onDelete,
}: {
  run: RunListItem;
  onDelete: () => void;
}) {
  const style = STATUS_STYLES[run.status];
  const accent = run.previewAccentHex ?? "#23232f";
  const initial = (run.previewTitle ?? run.ideaText).charAt(0).toUpperCase();

  return (
    <li className="group">
      <div className="card-row rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-white/[0.045] transition">
        <div
          className="h-12 w-20 rounded-lg flex items-center justify-center text-white text-xs font-extrabold shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accent}, #0e0e12)`,
          }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ring-1 ${style.bg} ${style.text} ${style.ring}`}
            >
              {style.label}
              {run.status === "running" && run.currentStage !== null
                ? ` · stage ${run.currentStage} / 12`
                : ""}
            </span>
            {run.scoreValue !== null && (
              <span className="text-xs font-mono text-emerald-400">
                {run.scoreValue} / 100
              </span>
            )}
          </div>
          <Link
            href={`/runs/${run.id}`}
            className="block text-sm font-medium text-white mt-1 truncate hover:text-yt-300 transition"
          >
            {run.ideaText}
          </Link>
          <p className="text-xs text-ink-400 mt-0.5">
            {relativeTime(run.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete run"
          className="h-8 w-8 rounded-md flex items-center justify-center text-ink-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition"
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
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </li>
  );
}
