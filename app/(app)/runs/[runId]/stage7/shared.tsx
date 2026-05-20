"use client";

import type { ScriptSection } from "@/lib/validation/script";

export function StageHeader({
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
          Retention script
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

export function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Retention curve as a lightweight inline SVG (decorative — Feature #15 ships
// the real curve). Disclosed as heuristic in the UI.
export function RetentionCurve({
  curve,
}: {
  curve: { timeSec: number; predicted: number }[];
}) {
  if (curve.length < 2) return null;
  const w = 100;
  const h = 28;
  const maxT = curve.at(-1)!.timeSec || 1;
  const pts = curve
    .map((s) => {
      const x = (s.timeSec / maxT) * w;
      const y = h - (s.predicted / 100) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-full h-8"
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke="#ff0033"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function SectionBody({ section }: { section: ScriptSection }) {
  return (
    <div className="space-y-1.5">
      {section.paragraphs.map((p, i) => {
        if (p.marker === "skeleton") {
          return (
            <p key={i} className="text-sm text-white leading-relaxed">
              <span className="mr-1.5 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-result-500/15 text-result-500">
                skeleton
              </span>
              {p.text}
            </p>
          );
        }
        if (p.marker === "personality") {
          return (
            <p key={i} className="text-sm text-ink-300 leading-relaxed">
              <span className="mr-1.5 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-curiosity-500/15 text-curiosity-500">
                personality
              </span>
              {p.personalityPrompt ? (
                <span className="italic text-ink-400">[{p.personalityPrompt}] </span>
              ) : null}
              {p.text}
            </p>
          );
        }
        return (
          <p key={i} className="text-sm text-ink-200 leading-relaxed">
            {p.text}
          </p>
        );
      })}
      {section.brollCues.map((b, i) => (
        <p key={`b${i}`} className="text-xs text-ink-400 italic">
          (b-roll) {b.cue}
        </p>
      ))}
    </div>
  );
}
