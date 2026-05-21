"use client";

import type { TitleTrigger } from "@/lib/validation/titles";
import type { ThumbnailBrief } from "@/lib/validation/thumbnails";

import { TRIGGER_STYLE } from "./shared";

const PLACEMENT_POS: Record<string, string> = {
  "left-third": "left-3 top-1/2 -translate-y-1/2",
  "right-third": "right-3 top-1/2 -translate-y-1/2",
  center: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "inset-bottom-right": "right-2 bottom-2",
  "inset-bottom-left": "left-2 bottom-2",
};

function swatchOf(brief: ThumbnailBrief, role: string): string | undefined {
  return brief.palette.find((p) => p.role === role)?.hex;
}

// One concept brief. Dynamic hex values use inline styles (Tailwind can't see
// `bg-[#xxxxxx]` from data); the trigger tokens use literal classes.
export function ThumbnailBriefCard({
  brief,
  trigger,
  index,
  stale,
  pending,
  onRegenerate,
}: {
  brief: ThumbnailBrief;
  trigger: TitleTrigger;
  index: number;
  stale: boolean;
  pending: boolean;
  onRegenerate: () => void;
}) {
  const t = TRIGGER_STYLE[trigger];
  const bg = swatchOf(brief, "background") ?? "#13131a";
  const accent = swatchOf(brief, "accent") ?? "#ffffff";
  const inset =
    brief.characterPlacement === "inset-bottom-right" ||
    brief.characterPlacement === "inset-bottom-left";

  return (
    <div className="card rounded-2xl p-4 flex flex-col">
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-wider ring-1 ${t.badge}`}
        >
          {t.label}
        </span>
        <span className="text-[10px] font-mono text-ink-400">
          Brief 0{index + 1}
        </span>
      </div>

      <p className="text-[10px] uppercase tracking-wider text-ink-400 mt-3">
        Pairs with title {stale && <span className="text-amber-400">· stale</span>}
      </p>
      <p className="text-sm font-semibold text-white">{brief.pairsWithTitle}</p>

      {/* 16:9 composition preview — an approximation, not the final image */}
      <div
        className="mt-3 aspect-[16/9] rounded-lg overflow-hidden relative ring-1 ring-white/10"
        style={{
          background: `radial-gradient(circle at 70% 45%, ${accent}33, transparent 60%), ${bg}`,
        }}
      >
        {brief.characterPlacement !== "none" && (
          <div
            className={`absolute ${PLACEMENT_POS[brief.characterPlacement] ?? "left-3 top-1/2 -translate-y-1/2"} ${inset ? "h-8 w-8" : "h-14 w-14"} rounded-full bg-white/15 ring-2 ring-white/30 flex items-center justify-center text-lg`}
          >
            🙂
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
          <span
            className="font-extrabold leading-[0.95] text-lg drop-shadow"
            style={{ color: brief.overlayText.color }}
          >
            {brief.overlayText.text}
          </span>
        </div>
        <span className="absolute top-1.5 left-1.5 text-[8px] font-mono text-white/70 bg-black/40 px-1 rounded">
          16:9 · 1280×720
        </span>
      </div>

      <Field label="Composition" value={brief.composition} />
      {brief.facialExpression && (
        <Field label="Facial expression" value={brief.facialExpression} />
      )}
      <Field label="Background" value={brief.backgroundConcept} />

      <p className="text-[10px] uppercase tracking-wider text-ink-400 mt-3">
        Palette · click to copy
      </p>
      <div className="mt-1.5 flex gap-2">
        {brief.palette.map((p) => (
          <button
            key={p.role}
            type="button"
            onClick={() => void navigator.clipboard?.writeText(p.hex)}
            title={`${p.role} · ${p.hex}`}
            className="flex flex-col items-center gap-1"
          >
            <span
              className="h-7 w-7 rounded-md ring-1 ring-white/15"
              style={{ background: p.hex }}
            />
            <span className="text-[8px] font-mono text-ink-400">{p.role}</span>
          </button>
        ))}
      </div>

      <p className="text-[10px] uppercase tracking-wider text-ink-400 mt-3">
        Overlay text · {brief.overlayText.wordCount} words
        {brief.truncationOccurred && (
          <span className="text-amber-400"> · truncated</span>
        )}
      </p>
      <p
        className="mt-1 inline-block font-mono text-xs font-bold px-2 py-1 rounded border border-dashed border-white/20"
        style={{ color: brief.overlayText.color }}
      >
        {brief.overlayText.text}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {brief.styleChips.map((c) => (
          <span
            key={c}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 ring-1 ring-white/10 text-ink-300"
          >
            {c}
          </span>
        ))}
      </div>

      <details className="mt-3">
        <summary className="text-[11px] text-ink-400 cursor-pointer hover:text-ink-200">
          Why it works
        </summary>
        <p className="text-[12px] text-ink-300 mt-1 leading-relaxed">
          {brief.whyItWorks}
        </p>
      </details>

      <div className="mt-auto pt-4 flex items-center gap-2">
        <button
          type="button"
          disabled
          title="Coming in Phase 3 with AI thumbnail generation"
          className="text-xs font-semibold text-ink-500 bg-white/5 ring-1 ring-white/10 px-3 py-1.5 rounded-md cursor-not-allowed"
        >
          Lock in
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onRegenerate}
          className="text-xs font-semibold text-ink-300 hover:text-white bg-white/5 ring-1 ring-white/10 px-3 py-1.5 rounded-md transition disabled:opacity-50"
        >
          {pending ? "…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-[12px] text-ink-200 mt-0.5 leading-relaxed">{value}</p>
    </div>
  );
}
