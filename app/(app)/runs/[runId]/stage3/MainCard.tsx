"use client";

import type { CompetitorData } from "@/lib/validation/competitor";

import { OutlierTile } from "./OutlierTile";
import { RegenerateButton } from "./RegenerateDialog";

export function MainCard({
  data,
  stale,
  runId,
}: {
  data: CompetitorData;
  stale: boolean;
  runId: string;
}) {
  const avg =
    data.outliers.length === 0
      ? 0
      : Math.round(
          (data.outliers.reduce((s, o) => s + o.viewMultiple, 0) /
            data.outliers.length) *
            10,
        ) / 10;
  return (
    <li className="card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-white">
            Competitor outliers
            <span
              className={`ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                stale
                  ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
                  : "bg-yt-600/15 text-yt-400 ring-1 ring-yt-600/30"
              }`}
            >
              Stage 3 · {stale ? "Stale" : "Complete"}
            </span>
          </h2>
          <p className="text-xs text-ink-400 mt-1">
            Found {data.outliers.length} outliers across{" "}
            {data.diagnostics.competitorsScanned} competitors in the last 30
            days · avg {avg}× channel median
          </p>
        </div>
        <RegenerateButton runId={runId} cached={data} />
      </div>
      <MainCardBody data={data} stale={stale} />
    </li>
  );
}

export function MainCardBody({
  data,
  stale,
}: {
  data: CompetitorData;
  stale: boolean;
}) {
  return (
    <>
      <Banners data={data} stale={stale} />
      {data.extractedPatterns.length > 0 && (
        <Patterns patterns={data.extractedPatterns} />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {data.outliers.map((o) => (
          <OutlierTile key={o.videoId} outlier={o} />
        ))}
      </div>
    </>
  );
}

function Banners({ data, stale }: { data: CompetitorData; stale: boolean }) {
  const d = data.diagnostics;
  const banners: Array<{ key: string; title: string; body: string }> = [];
  if (stale) {
    banners.push({
      key: "stale",
      title: "Upstream change detected",
      body:
        "An earlier stage was re-run; outlier data may no longer reflect the latest competitor set.",
    });
  }
  if (d.weakSignal) {
    banners.push({
      key: "weak",
      title: `Weak signal · only ${data.outliers.length > 0 ? "few" : "no"} competitors contributing`,
      body:
        "Statistical confidence is low — patterns may not generalize. Add more competitors for stronger signal.",
    });
  }
  if (d.singleCreatorDominance) {
    banners.push({
      key: "dom",
      title: "One creator dominates the outlier set",
      body:
        "A single channel hit the 5-per-channel diversity cap. Patterns may reflect that creator's voice more than your niche.",
    });
  }
  if (d.fallback90DayUsedFor.length > 0) {
    banners.push({
      key: "fallback",
      title: `Stale 90-day fallback used for ${d.fallback90DayUsedFor.length} competitor${d.fallback90DayUsedFor.length === 1 ? "" : "s"}`,
      body:
        "Those competitors published fewer than 10 long-form videos in the last 30 days. Multiples for their outliers are slightly less precise.",
    });
  }
  if (d.competitorsSkipped.length > 0) {
    banners.push({
      key: "skipped",
      title: `${d.competitorsSkipped.length} competitor${d.competitorsSkipped.length === 1 ? "" : "s"} skipped`,
      body: d.competitorsSkipped
        .map((s) => `${s.channelTitle ?? s.channelId}: ${s.reason}`)
        .join(" · "),
    });
  }
  if (banners.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      {banners.map((b) => (
        <div
          key={b.key}
          className="rounded-md bg-amber-500/[0.06] ring-1 ring-amber-500/20 p-3 text-xs"
        >
          <p className="font-semibold text-amber-300">{b.title}</p>
          <p className="text-ink-300 mt-0.5">{b.body}</p>
        </div>
      ))}
    </div>
  );
}

function Patterns({
  patterns,
}: {
  patterns: CompetitorData["extractedPatterns"];
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {patterns.map((p, i) => {
        const tone =
          p.confidence === "high"
            ? "bg-result-500/10 text-result-500 ring-result-500/30"
            : p.confidence === "medium"
              ? "bg-curiosity-500/10 text-curiosity-500 ring-curiosity-500/30"
              : "bg-white/5 text-ink-300 ring-white/10";
        return (
          <span
            key={i}
            className={`text-[11px] px-2.5 py-1 rounded-full ring-1 ${tone}`}
            title={`${p.confidence} · ${p.category} · ${p.evidence.length} of ${patterns.length}`}
          >
            {p.pattern} ({p.evidence.length})
          </span>
        );
      })}
    </div>
  );
}
