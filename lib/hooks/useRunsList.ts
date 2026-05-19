"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RunListItem, RunStatus } from "@/lib/validation/runs";

export type RunsListResponse = {
  runs: RunListItem[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<"all" | RunStatus, number>;
  activeChannelId: string;
};

export type UseRunsListArgs = {
  q?: string;
  status?: RunStatus;
  page: number;
};

export type UseRunsListResult = {
  data: RunsListResponse | null;
  loading: boolean;
  error: { code: string; message: string } | null;
  refresh: () => Promise<void>;
};

const DEBOUNCE_MS = 250;

export function useRunsList(args: UseRunsListArgs): UseRunsListResult {
  const [data, setData] = useState<RunsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetcher = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (args.q) params.set("q", args.q);
      if (args.status) params.set("status", args.status);
      params.set("page", String(args.page));

      const res = await fetch(`/api/runs?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({}))) as { code?: string; message?: string };
        setError({
          code: body.code ?? "UPSTREAM_ERROR",
          message: body.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      const json: RunsListResponse = await res.json();
      setData(json);
    } catch (err) {
      setError({
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Failed to load runs.",
      });
    } finally {
      setLoading(false);
    }
  }, [args.q, args.status, args.page]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetcher();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetcher]);

  return { data, loading, error, refresh: fetcher };
}
