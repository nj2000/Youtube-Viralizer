"use client";

import { useState } from "react";

import {
  TITLE_CHAR_HARD_LIMIT,
  type TitleVariant,
} from "@/lib/validation/titles";

import { TRIGGER_STYLE, charCounterClass, ctrWidthPct } from "./shared";

export function TitleCard({
  runId,
  variant,
}: {
  runId: string;
  variant: TitleVariant;
}) {
  const style = TRIGGER_STYLE[variant.trigger];
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(variant.text);

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

  const lock = (text: string) =>
    post("/api/pipeline/titles/lock", {
      runId,
      trigger: variant.trigger,
      titleText: text,
    });
  const unlock = () =>
    post("/api/pipeline/titles/unlock", { runId, trigger: variant.trigger });
  const regenerate = () =>
    post("/api/pipeline/titles/regenerate", {
      runId,
      trigger: variant.trigger,
    });

  return (
    <div
      className={`card-row rounded-lg p-4 ${variant.lockedIn ? "ring-1 ring-yt-600/40" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 ${style.badge}`}
        >
          {style.label}
        </span>
        <span className={`text-[11px] font-mono ${charCounterClass(variant.charCount)}`}>
          {variant.truncated && variant.originalLength
            ? `${variant.originalLength} → ${variant.charCount} / 100`
            : `${variant.charCount} / 100`}
        </span>
      </div>

      {editing ? (
        <textarea
          value={draft}
          maxLength={TITLE_CHAR_HARD_LIMIT}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="input mt-3 w-full rounded-md px-2 py-1.5 text-sm"
          autoFocus
        />
      ) : (
        <h4 className="mt-3 text-sm font-semibold text-white leading-snug">
          {variant.text}
        </h4>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-ink-400">Predicted CTR</p>
          <p className={`font-semibold ${style.accentText}`}>
            {variant.predictedCtrLift > 0 ? "+" : ""}
            {variant.predictedCtrLift}% est.
          </p>
          <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full ${style.bar}`}
              style={{ width: `${ctrWidthPct(variant.predictedCtrLift)}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-ink-400">Voice match</p>
          <p className={`font-semibold ${style.accentText}`}>
            {variant.voiceMatch.label}
            {variant.voiceMatch.label !== "fallback"
              ? ` · ${variant.voiceMatch.score}/10`
              : ""}
          </p>
          <p className="text-ink-400 mt-1 truncate">{variant.audienceCluster}</p>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-ink-300 line-clamp-3">
        {variant.reasoning}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy || draft.trim().length === 0}
              onClick={async () => {
                await lock(draft.trim());
                setEditing(false);
              }}
              className="btn-primary text-xs px-3 py-1 rounded-md text-white font-semibold disabled:opacity-60"
            >
              Save &amp; lock
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(variant.text);
                setEditing(false);
              }}
              className="text-xs px-2.5 py-1 rounded-md ring-1 ring-white/10 bg-white/5 text-white"
            >
              Cancel
            </button>
          </>
        ) : variant.lockedIn ? (
          <button
            type="button"
            disabled={busy}
            onClick={unlock}
            className="text-xs px-2.5 py-1 rounded-md ring-1 ring-yt-600/30 bg-yt-600/10 text-yt-400 disabled:opacity-60"
          >
            Unlock
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => lock(variant.text)}
              className="btn-primary text-xs px-3 py-1 rounded-md text-white font-semibold disabled:opacity-60"
            >
              Lock in
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={regenerate}
              className="text-xs px-2.5 py-1 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-60"
            >
              {busy ? "…" : "Regenerate"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(variant.text);
                setEditing(true);
              }}
              className="text-xs px-2.5 py-1 rounded-md ring-1 ring-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-60"
            >
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}
