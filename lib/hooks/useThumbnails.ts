"use client";

import { useCallback, useState } from "react";

import type { TitleTrigger } from "@/lib/validation/titles";

// Client actions for the Stage 9 card. Routes persist + publish stage_complete,
// which useRun turns into a run re-fetch — so the card re-renders from fresh
// thumbnails_data. We track per-trigger pending + a top-level busy for buttons.

export type UseThumbnails = {
  pending: Set<TitleTrigger>;
  busy: boolean;
  error: string | null;
  regenerate: (trigger: TitleTrigger) => Promise<void>;
  runThumbnails: () => Promise<void>;
};

export function useThumbnails(runId: string): UseThumbnails {
  const [pending, setPending] = useState<Set<TitleTrigger>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<void> => {
      setError(null);
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { code?: string }
          | null;
        const code = payload?.code ?? `HTTP_${res.status}`;
        setError(code);
        throw new Error(code);
      }
    },
    [],
  );

  const regenerate = useCallback(
    async (trigger: TitleTrigger): Promise<void> => {
      setPending((prev) => new Set(prev).add(trigger));
      try {
        await post("/api/pipeline/thumbnails/regenerate", { runId, trigger });
      } catch {
        // surfaced via `error` state; swallow so it can't crash the overlay.
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(trigger);
          return next;
        });
      }
    },
    [post, runId],
  );

  const runThumbnails = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await post("/api/pipeline/thumbnails", { runId });
    } catch {
      // surfaced via `error` state.
    } finally {
      setBusy(false);
    }
  }, [post, runId]);

  return { pending, busy, error, regenerate, runThumbnails };
}
