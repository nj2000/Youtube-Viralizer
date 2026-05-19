"use client";

import { useEffect, useRef, useState } from "react";

import type { RunRowView } from "@/lib/validation/runs";

export type RunStreamState = "loading" | "live" | "terminal" | "error";

export type RunProgress = {
  stage: number;
  message: string;
  tokensSoFar?: number;
  tokensTotalEstimate?: number;
};

export type RunStreamError = { code: string; message: string };

export type UseRunResult = {
  run: RunRowView | null;
  progress: RunProgress | null;
  state: RunStreamState;
  error: RunStreamError | null;
  refresh: () => Promise<void>;
};

function parseSSEEvent(raw: string): { name: string; data: unknown } | null {
  let name = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join("\n");
  try {
    return { name, data: JSON.parse(joined) };
  } catch {
    return { name, data: joined };
  }
}

const TERMINAL_STATUSES = new Set(["complete", "gated_failed", "error"]);

export function useRun(runId: string): UseRunResult {
  const [run, setRun] = useState<RunRowView | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [state, setState] = useState<RunStreamState>("loading");
  const [error, setError] = useState<RunStreamError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  async function refresh(): Promise<void> {
    try {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (!res.ok || !mountedRef.current) return;
      const fresh: RunRowView = await res.json();
      setRun(fresh);
      if (TERMINAL_STATUSES.has(fresh.status)) setState("terminal");
    } catch {
      // ignore — SSE stream is the primary source
    }
  }

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState("loading");
    setProgress(null);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/stream`, {
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          if (!mountedRef.current) return;
          setError({
            code: response.status === 404 ? "RUN_NOT_FOUND" : "UPSTREAM_ERROR",
            message: `HTTP ${response.status}`,
          });
          setState("error");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const event = parseSSEEvent(raw);
            if (!event || !mountedRef.current) continue;

            switch (event.name) {
              case "snapshot": {
                const snap = event.data as RunRowView;
                setRun(snap);
                setState(
                  TERMINAL_STATUSES.has(snap.status) ? "terminal" : "live",
                );
                break;
              }
              case "progress": {
                setProgress(event.data as RunProgress);
                break;
              }
              case "stage_complete": {
                // Lightweight bus event — re-fetch the row for fresh JSONB.
                void refresh();
                break;
              }
              case "run_complete":
              case "run_gated":
              case "run_error": {
                void refresh();
                setState("terminal");
                if (event.name === "run_error") {
                  const payload = event.data as { code?: string };
                  setError({
                    code: payload.code ?? "UNKNOWN_ERROR",
                    message: "Run ended in error.",
                  });
                }
                break;
              }
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (!mountedRef.current) return;
        setError({
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Stream failed",
        });
        setState("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { run, progress, state, error, refresh };
}
