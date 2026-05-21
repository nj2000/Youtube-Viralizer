"use client";

import { useCallback, useState } from "react";

import type { EngagementDraftType } from "@/lib/validation/engagement";

// Client actions for Stage 12. Routes persist + publish stage_complete /
// run_complete → useRun re-fetches and the card re-renders.

export type UseEngagement = {
  pending: Set<EngagementDraftType>;
  busy: boolean;
  error: string | null;
  regenerate: (draftType: EngagementDraftType) => Promise<void>;
  runEngagement: () => Promise<void>;
  downloadBundle: () => void;
};

export function useEngagement(runId: string): UseEngagement {
  const [pending, setPending] = useState<Set<EngagementDraftType>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (path: string, body: Record<string, unknown>): Promise<void> => {
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { code?: string } | null;
      const code = payload?.code ?? `HTTP_${res.status}`;
      setError(code);
      throw new Error(code);
    }
  }, []);

  const regenerate = useCallback(
    async (draftType: EngagementDraftType): Promise<void> => {
      setPending((p) => new Set(p).add(draftType));
      try {
        await post("/api/pipeline/engagement/regenerate", { runId, draftType });
      } catch {
        // surfaced via `error`.
      } finally {
        setPending((p) => {
          const n = new Set(p);
          n.delete(draftType);
          return n;
        });
      }
    },
    [post, runId],
  );

  const runEngagement = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await post("/api/pipeline/engagement", { runId });
    } catch {
      // surfaced via `error`.
    } finally {
      setBusy(false);
    }
  }, [post, runId]);

  const downloadBundle = useCallback(() => {
    window.open(`/api/runs/${runId}/export?format=markdown`, "_blank");
  }, [runId]);

  return { pending, busy, error, regenerate, runEngagement, downloadBundle };
}
