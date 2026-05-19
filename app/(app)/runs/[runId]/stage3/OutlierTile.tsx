"use client";

import type { Outlier } from "@/lib/validation/competitor";

import { TRIGGER_CHIP_CLASS, TRIGGER_LABEL_HUMAN } from "./shared";

export function OutlierTile({ outlier }: { outlier: Outlier }) {
  const isMissing = outlier.deltaStatus !== "complete";
  return (
    <a
      href={`https://www.youtube.com/watch?v=${outlier.videoId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="card-row rounded-lg overflow-hidden block hover:ring-1 hover:ring-yt-600/40 transition"
    >
      <div className="aspect-video relative bg-ink-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={outlier.thumbnailUrl}
          alt={outlier.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-yt-600 text-white text-[11px] font-bold">
          {outlier.viewMultiple}×
        </span>
        {outlier.isShort && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-bold">
            SHORT
          </span>
        )}
        {outlier.isLivestreamVod && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-bold">
            LIVESTREAM
          </span>
        )}
        {outlier.recencyBoosted && (
          <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/70 text-curiosity-500 text-[10px] font-bold">
            FRESH
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-white leading-snug line-clamp-2">
          {outlier.title}
        </p>
        <p className="text-xs text-ink-300 mt-1 truncate">
          {outlier.channelTitle}
          {outlier.channelHandle ? ` · @${outlier.channelHandle}` : ""}
        </p>
        <p className="text-[11px] text-ink-400 mt-1">
          {Math.round(outlier.viewCount / 1000).toLocaleString()}K views
        </p>
        {!isMissing && (
          <p className="text-[11px] text-ink-300 mt-2 line-clamp-2">
            {outlier.deltaLabel}
          </p>
        )}
        {isMissing && (
          <span className="mt-2 inline-block text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30 font-bold">
            PARTIAL
          </span>
        )}
        {outlier.triggerLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {outlier.triggerLabels.map((t) => (
              <span
                key={t}
                className={`text-[10px] px-1.5 py-0.5 rounded-md ring-1 ${TRIGGER_CHIP_CLASS[t]}`}
              >
                {TRIGGER_LABEL_HUMAN[t]}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}
