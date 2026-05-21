"use client";

import { useCallback, useState } from "react";

import type { SeoSection } from "@/lib/validation/seo";

// Client actions for the Stage 10 SEO card. Routes persist + publish
// stage_complete, which useRun turns into a run re-fetch (the card re-renders
// from fresh seo_data). Per-section pending + a top-level busy for buttons.

export type UseSeo = {
  pending: Set<SeoSection>;
  busy: boolean;
  error: string | null;
  regenerate: (section: SeoSection) => Promise<void>;
  runSeo: () => Promise<void>;
  toggleSponsored: (value: boolean) => Promise<void>;
  copyAll: () => Promise<void>;
};

export function useSeo(runId: string): UseSeo {
  const [pending, setPending] = useState<Set<SeoSection>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>, method = "POST"): Promise<void> => {
      setError(null);
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { code?: string } | null;
        const code = payload?.code ?? `HTTP_${res.status}`;
        setError(code);
        throw new Error(code);
      }
    },
    [],
  );

  const regenerate = useCallback(
    async (section: SeoSection): Promise<void> => {
      setPending((p) => new Set(p).add(section));
      try {
        await post("/api/pipeline/seo/regenerate-section", { runId, section });
      } catch {
        // surfaced via `error`; swallow.
      } finally {
        setPending((p) => {
          const n = new Set(p);
          n.delete(section);
          return n;
        });
      }
    },
    [post, runId],
  );

  const withBusy = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setBusy(true);
      try {
        await fn();
      } catch {
        // surfaced via `error`.
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const runSeo = useCallback(
    () => withBusy(() => post("/api/pipeline/seo", { runId })),
    [withBusy, post, runId],
  );

  const toggleSponsored = useCallback(
    (value: boolean) =>
      withBusy(() => post(`/api/runs/${runId}/sponsored`, { is_sponsored: value }, "PATCH")),
    [withBusy, post, runId],
  );

  const copyAll = useCallback(
    () =>
      withBusy(async () => {
        const res = await fetch(`/api/pipeline/seo/copy-format?runId=${runId}`);
        if (!res.ok) {
          setError(`HTTP_${res.status}`);
          return;
        }
        const data = (await res.json()) as { description?: string };
        if (data.description) await navigator.clipboard?.writeText(data.description);
      }),
    [withBusy, runId],
  );

  return { pending, busy, error, regenerate, runSeo, toggleSponsored, copyAll };
}
