"use client";

import { useState } from "react";

import { parseChannelUrl } from "@/lib/youtube/validate";
import type { Competitor } from "@/lib/validation/channels";

export function AddCompetitorInput({
  existing,
  onAdd,
}: {
  existing: Competitor[];
  onAdd: (competitor: Competitor) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Phase 1 simplification: manual adds carry the raw handle/id as the title.
  // Phase 2 will hydrate the actual title via a YouTube fetch on confirm.
  function handleAdd() {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return;

    try {
      const parsed = parseChannelUrl(trimmed);
      const titleGuess =
        parsed.kind === "handle"
          ? `@${parsed.value}`
          : parsed.kind === "id"
            ? parsed.value
            : parsed.value;
      const youtubeChannelId =
        parsed.kind === "id" ? parsed.value : `MANUAL_${parsed.value}`;

      if (
        existing.some((c) => c.youtubeChannelId === youtubeChannelId) ||
        existing.length >= 20
      ) {
        setError(
          existing.length >= 20
            ? "Maximum 20 competitors per channel."
            : "Already in your list.",
        );
        return;
      }

      if (parsed.kind !== "id") {
        setError(
          "Paste a full channel URL with the UC… id; handles will be resolved on save.",
        );
      }

      onAdd({
        youtubeChannelId,
        handle: parsed.kind === "handle" ? parsed.value : null,
        title: titleGuess,
        subscriberCount: null,
        medianViews: null,
        source: "manual",
      });
      setUrl("");
    } catch {
      setError("That doesn't look like a YouTube channel URL.");
    }
  }

  return (
    <div className="mt-3 flex items-stretch gap-2">
      <input
        type="text"
        inputMode="url"
        placeholder="Paste another competitor's channel URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className={`input flex-1 rounded-lg px-3 py-2 text-sm ${error ? "input-error" : ""}`}
      />
      <button
        type="button"
        onClick={handleAdd}
        className="px-3 py-2 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white font-semibold rounded-lg transition text-sm"
      >
        Add
      </button>
    </div>
  );
}
