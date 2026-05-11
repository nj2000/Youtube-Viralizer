"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type StageStreamState = "idle" | "running" | "done" | "error";

export type StageStreamError = { code: string; message: string };

export type UseStageStream<TProgress, TComplete> = {
  state: StageStreamState;
  progress: TProgress[];
  result: TComplete | null;
  error: StageStreamError | null;
  start: (body?: unknown) => Promise<void>;
  abort: () => void;
};

type ParsedEvent = { name: string; data: unknown };

export function parseSSEEvent(raw: string): ParsedEvent | null {
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

export function useStageStream<TProgress, TComplete>(
  url: string,
): UseStageStream<TProgress, TComplete> {
  const [state, setState] = useState<StageStreamState>("idle");
  const [progress, setProgress] = useState<TProgress[]>([]);
  const [result, setResult] = useState<TComplete | null>(null);
  const [error, setError] = useState<StageStreamError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(
    async (body?: unknown) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setState("running");
      setProgress([]);
      setResult(null);
      setError(null);

      try {
        const response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!response.ok || !response.body) {
          if (!mountedRef.current) return;
          setError({
            code: "UPSTREAM_ERROR",
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
            if (event.name === "progress") {
              setProgress((prev) => [...prev, event.data as TProgress]);
            } else if (event.name === "complete") {
              setResult(event.data as TComplete);
              setState("done");
            } else if (event.name === "error") {
              setError(event.data as StageStreamError);
              setState("error");
            }
          }
        }

        if (mountedRef.current) {
          setState((current) => (current === "running" ? "done" : current));
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
    },
    [url],
  );

  return { state, progress, result, error, start, abort };
}
