"use client";

import { useState } from "react";

export function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs font-medium text-ink-200 bg-white/5 hover:bg-white/10 rounded-md ring-1 ring-white/10 px-2.5 py-1.5 transition"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

// A metadata section sub-card: icon + title + subtitle, right-side controls
// (count pill, copy, regenerate), and the section body.
export function SectionShell({
  title,
  subtitle,
  warn,
  count,
  onRegenerate,
  regenerating,
  copyText,
  children,
}: {
  title: string;
  subtitle: string;
  warn?: boolean;
  count?: string;
  onRegenerate: () => void;
  regenerating: boolean;
  copyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`h-9 w-9 rounded-lg flex items-center justify-center ring-1 ${warn ? "bg-amber-500/15 ring-amber-500/30 text-amber-300" : "bg-yt-600/15 ring-yt-600/30 text-yt-400"}`}
          >
            ◆
          </span>
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className={`text-[11px] ${warn ? "text-amber-300" : "text-ink-400"}`}>
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {count && (
            <span className="text-[11px] font-mono text-ink-300 bg-white/5 ring-1 ring-white/10 rounded-md px-2 py-1">
              {count}
            </span>
          )}
          <CopyButton text={copyText} />
          <button
            type="button"
            disabled={regenerating}
            onClick={onRegenerate}
            className="text-xs font-medium text-ink-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-md ring-1 ring-white/10 px-2.5 py-1.5 transition disabled:opacity-50"
          >
            {regenerating ? "…" : "Regenerate"}
          </button>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function SeoHeaderPill({ text, tone }: { text: string; tone: "ok" | "warn" | "err" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-300 ring-amber-500/30"
        : "bg-rose-500/10 text-rose-300 ring-rose-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 ${cls}`}>
      {text}
    </span>
  );
}
