"use client";

import { useState } from "react";

import type {
  CommunityPost,
  EngagementDrafts,
  SuggestedReplyTemplate,
} from "@/lib/validation/engagement";

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="text-[11px] font-medium text-ink-200 bg-white/5 hover:bg-white/10 rounded-md ring-1 ring-white/10 px-2.5 py-1.5 transition"
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center text-[11px] bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30 rounded px-2 py-0.5 font-semibold">
      {children.replace(/_/g, " ")}
    </span>
  );
}

export function DraftCard({
  label,
  accent,
  text,
  badges,
  poll,
  pending,
  onRegenerate,
}: {
  label: string;
  accent: string;
  text: string;
  badges: string[];
  poll?: CommunityPost["poll"];
  pending: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${accent}`}>
          {label}
        </span>
        <div className="flex items-center gap-2">
          <CopyBtn text={text} />
          <button
            type="button"
            disabled={pending}
            onClick={onRegenerate}
            className="text-[11px] font-medium text-ink-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-md ring-1 ring-white/10 px-2.5 py-1.5 transition disabled:opacity-50"
          >
            {pending ? "…" : "Regenerate"}
          </button>
        </div>
      </div>
      <p className="mt-3 rounded-lg bg-ink-900/60 ring-1 ring-white/7 p-4 text-[14px] text-ink-100 leading-relaxed whitespace-pre-line">
        {text}
      </p>
      {poll && (
        <div className="mt-2 rounded-lg ring-1 ring-white/5 bg-white/[0.025] p-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Poll · {poll.question}</p>
          <ul className="mt-1.5 space-y-1">
            {poll.options.map((o, i) => (
              <li key={i} className="text-xs text-ink-200">• {o}</li>
            ))}
          </ul>
        </div>
      )}
      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <Badge key={b}>{b}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function RepliesPanel({ replies, pending, onRegenerate }: { replies: SuggestedReplyTemplate[]; pending: boolean; onRegenerate: () => void }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Suggested replies</h3>
        <button
          type="button"
          disabled={pending}
          onClick={onRegenerate}
          className="text-[11px] font-medium text-ink-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-md ring-1 ring-white/10 px-2.5 py-1.5 transition disabled:opacity-50"
        >
          {pending ? "…" : "Regenerate"}
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {replies.map((r, i) => (
          <li key={i} className="card-row rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 bg-white/5 text-ink-300 ring-white/10">
                {r.trigger.replace(/_/g, " ")}
              </span>
              <span className="text-[11px] text-ink-400 font-mono">on “{r.keyword}”</span>
            </div>
            <p className="text-[13px] text-ink-200 mt-1.5 leading-relaxed">{r.replyTemplate}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DELIVERABLES = [
  "Competitor outliers", "Virality score", "Titles", "Cold-open hook",
  "Retention script", "Anti-pattern lint", "Thumbnail briefs", "SEO metadata",
  "A/B test plan", "Engagement drafts",
];

export function ShipItCapstone({ data, onDownload }: { data: EngagementDrafts; onDownload: () => void }) {
  void data;
  return (
    <div className="card rounded-2xl p-6 ring-1 ring-emerald-500/25" style={{ background: "linear-gradient(180deg, rgba(16,185,129,0.08), rgba(255,255,255,0)) #13131a" }}>
      <div className="flex items-center gap-3">
        <span className="h-10 w-10 rounded-xl bg-emerald-500/20 ring-1 ring-emerald-500/40 flex items-center justify-center text-emerald-300 text-lg">✓</span>
        <div>
          <h3 className="text-lg font-extrabold text-white">All 12 stages complete.</h3>
          <p className="text-xs text-ink-300">Your viral kit is ready to ship.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-1.5">
        {DELIVERABLES.map((d) => (
          <p key={d} className="text-[11px] text-ink-300 flex items-center gap-1.5">
            <span className="text-emerald-400">✓</span> {d}
          </p>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onDownload} className="btn-primary text-sm px-4 py-2 rounded-lg text-white font-semibold">
          Download bundle (.md)
        </button>
      </div>
    </div>
  );
}
