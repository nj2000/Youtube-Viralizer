"use client";

import { useState } from "react";

import type { HookVariant } from "@/lib/validation/hook";

import { ARCHETYPE_LABEL, RISK_STYLE, formatMSS } from "./shared";

const WARNING_LABEL: Record<string, string> = {
  OVER_WORD_LIMIT: "over word limit",
  OVER_TIME_BUDGET: "over 30s",
  NO_CONCRETE_PROMISE: "no concrete promise",
  ANTI_PATTERN_DETECTED: "cliché opener",
  ARCHETYPE_DUPLICATE: "duplicate angle",
  KILLER_COMBO: "killer combo",
};

export function HookCard({
  runId,
  variant,
  index,
  locked,
}: {
  runId: string;
  variant: HookVariant;
  index: 0 | 1 | 2;
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }
  async function del(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(path, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`card-row rounded-lg p-4 ${locked ? "ring-1 ring-result-500/40" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">
          {ARCHETYPE_LABEL[variant.archetype]} · → title {variant.linkedTitleIndex + 1}
        </span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 ${
            locked ? "bg-result-500/15 text-result-500 ring-result-500/35" : RISK_STYLE[variant.dropoffRiskRating]
          }`}
        >
          {locked ? "Locked" : `${variant.dropoffRiskRating} risk`}
        </span>
      </div>

      <ol className="mt-3 space-y-1.5">
        {variant.beats.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded bg-yt-600/10 text-yt-400 ring-1 ring-yt-600/20 h-fit">
              {formatMSS(b.timeSec)}
            </span>
            {b.line !== null ? (
              <span className="text-white leading-snug">{b.line}</span>
            ) : (
              <span className="text-ink-400 italic leading-snug">
                {b.brollCue}
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-400">
        <span>{variant.wordCount} words</span>
        <span>~{variant.speakTimeSec}s</span>
        <span>retention ~{variant.retention30sPredict}</span>
      </div>

      {variant.warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {variant.warnings.map((w) => (
            <span
              key={w}
              className={`text-[10px] px-1.5 py-0.5 rounded-md ring-1 ${
                w === "KILLER_COMBO"
                  ? "bg-fear-500/10 text-fear-500 ring-fear-500/30"
                  : "bg-amber-500/10 text-amber-400 ring-amber-500/30"
              }`}
            >
              {WARNING_LABEL[w] ?? w}
            </span>
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] text-ink-300 line-clamp-2">
        {variant.reasoning}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {locked ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => del("/api/pipeline/hook/lock", { runId })}
            className="text-xs px-2.5 py-1 rounded-md ring-1 ring-result-500/30 bg-result-500/10 text-result-500 disabled:opacity-60"
          >
            Unlock
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                post("/api/pipeline/hook/lock", { runId, variantIndex: index })
              }
              className="btn-primary text-xs px-3 py-1 rounded-md text-white font-semibold disabled:opacity-60"
            >
              Lock in
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                post("/api/pipeline/hook/regenerate", {
                  runId,
                  variantIndex: index,
                })
              }
              className="text-xs px-2.5 py-1 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-60"
            >
              {busy ? "…" : "Regenerate"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
