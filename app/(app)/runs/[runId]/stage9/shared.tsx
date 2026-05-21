"use client";

import type { TitleTrigger } from "@/lib/validation/titles";

// Full class literals so Tailwind v4's scanner picks them up (no dynamic
// `bg-${x}` — those are invisible to the scanner).
export const TRIGGER_STYLE: Record<
  TitleTrigger,
  { badge: string; label: string }
> = {
  curiosity: {
    badge: "bg-curiosity-500/15 text-curiosity-500 ring-curiosity-500/35",
    label: "Curiosity",
  },
  fear: {
    badge: "bg-fear-500/15 text-fear-500 ring-fear-500/35",
    label: "Fear",
  },
  result: {
    badge: "bg-result-500/15 text-result-500 ring-result-500/35",
    label: "Result",
  },
};

export function ThumbnailHeader({
  pill,
  pillClass,
  subtitle,
  right,
}: {
  pill: string;
  pillClass: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-extrabold tracking-tight text-white">
          Thumbnail Concepts
          <span
            className={`ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${pillClass}`}
          >
            {pill}
          </span>
        </h2>
        <p className="text-xs text-ink-400 mt-1">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}
