"use client";

import type { Competitor } from "@/lib/validation/channels";

export function CompetitorList({
  competitors,
  onChange,
}: {
  competitors: Competitor[];
  onChange: (next: Competitor[]) => void;
}) {
  if (competitors.length === 0) {
    return (
      <div className="rounded-lg p-6 text-center border border-dashed border-white/10 text-sm text-ink-400">
        No competitors yet. Add a few channels you compete with — we&apos;ll
        track their outliers.
      </div>
    );
  }

  function remove(youtubeChannelId: string) {
    onChange(
      competitors.filter((c) => c.youtubeChannelId !== youtubeChannelId),
    );
  }

  return (
    <ul className="space-y-2">
      {competitors.map((c) => (
        <li
          key={c.youtubeChannelId}
          className="card-row rounded-lg px-3 py-2.5 flex items-center gap-3"
        >
          <span className="h-8 w-8 rounded-full bg-gradient-to-br from-yt-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {c.title.charAt(0).toUpperCase() || "C"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {c.title}
              {c.source === "manual" && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-500">
                  added by you
                </span>
              )}
            </p>
            <p className="text-xs text-ink-400 truncate">
              {c.handle ? `@${c.handle} · ` : ""}
              {c.subscriberCount !== null
                ? `${c.subscriberCount.toLocaleString()} subs`
                : "subs hidden"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => remove(c.youtubeChannelId)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-ink-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
            aria-label={`Remove ${c.title}`}
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
