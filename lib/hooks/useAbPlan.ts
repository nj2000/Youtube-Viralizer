"use client";

import { useCallback, useState } from "react";

// Client actions for the Stage 11 A/B plan card. Routes persist + publish
// stage_complete → useRun re-fetches and the card re-renders from fresh
// ab_plan_data. Per-variant pending + a top-level busy.

export type UseAbPlan = {
  pending: Set<number>;
  busy: boolean;
  error: string | null;
  regenerate: (variantIndex: 0 | 1 | 2) => Promise<void>;
  runPlan: () => Promise<void>;
  copyMarkdown: (runId: string) => Promise<void>;
};

export function useAbPlan(runId: string): UseAbPlan {
  const [pending, setPending] = useState<Set<number>>(new Set());
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
    async (variantIndex: 0 | 1 | 2): Promise<void> => {
      setPending((p) => new Set(p).add(variantIndex));
      try {
        await post("/api/pipeline/ab-plan/regenerate", { runId, variantIndex });
      } catch {
        // surfaced via `error`.
      } finally {
        setPending((p) => {
          const n = new Set(p);
          n.delete(variantIndex);
          return n;
        });
      }
    },
    [post, runId],
  );

  const runPlan = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await post("/api/pipeline/ab-plan", { runId });
    } catch {
      // surfaced via `error`.
    } finally {
      setBusy(false);
    }
  }, [post, runId]);

  const copyMarkdown = useCallback(async (rid: string): Promise<void> => {
    const res = await fetch(`/api/pipeline/ab-plan/${rid}/markdown`);
    if (res.ok) await navigator.clipboard?.writeText(await res.text());
    else setError(`HTTP_${res.status}`);
  }, []);

  return { pending, busy, error, regenerate, runPlan, copyMarkdown };
}
