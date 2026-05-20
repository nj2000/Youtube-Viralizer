"use client";

import { useCallback, useRef, useState } from "react";

import type { ScriptData, ScriptTargetMinutes } from "@/lib/validation/script";

// Drives the Stage 7 direct-SSE script stream. Unlike useRun (which subscribes
// to the run-wide bus), this POSTs to /api/pipeline/script and reads the
// long-lived response body, parsing the custom event protocol (section_chunk,
// section_complete, complete, error) for the live typewriter UI.

export type ScriptStreamState = "idle" | "streaming" | "done" | "error";

export type SectionChunk = { sectionIndex: number; text: string };

export type UseScriptStream = {
  state: ScriptStreamState;
  progressMessage: string | null;
  chunks: SectionChunk[];
  result: ScriptData | null;
  errorCode: string | null;
  start: (runId: string, targetMinutes: ScriptTargetMinutes) => Promise<void>;
};

function parseFrame(raw: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx);
    let value = line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export function useScriptStream(): UseScriptStream {
  const [state, setState] = useState<ScriptStreamState>("idle");
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [chunks, setChunks] = useState<SectionChunk[]>([]);
  const [result, setResult] = useState<ScriptData | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const runningRef = useRef(false);

  const start = useCallback(
    async (runId: string, targetMinutes: ScriptTargetMinutes) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setState("streaming");
      setProgressMessage("Starting…");
      setChunks([]);
      setResult(null);
      setErrorCode(null);

      try {
        const res = await fetch("/api/pipeline/script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, targetMinutes }),
        });
        if (!res.ok || !res.body) {
          const code =
            res.status === 409
              ? "STREAM_IN_PROGRESS"
              : res.status === 429
                ? "RATE_LIMITED"
                : res.status === 503
                  ? "BUDGET_EXCEEDED"
                  : "UPSTREAM_ERROR";
          setErrorCode(code);
          setState("error");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const frame = parseFrame(raw);
            if (!frame) continue;
            switch (frame.event) {
              case "progress":
                setProgressMessage(
                  (frame.data as { message?: string }).message ?? null,
                );
                break;
              case "section_chunk": {
                const d = frame.data as { sectionIndex: number; deltaText: string };
                setChunks((prev) => {
                  const next = [...prev];
                  const existing = next.find((c) => c.sectionIndex === d.sectionIndex);
                  if (existing) existing.text += d.deltaText;
                  else next.push({ sectionIndex: d.sectionIndex, text: d.deltaText });
                  return next;
                });
                break;
              }
              case "complete":
                setResult(frame.data as ScriptData);
                setState("done");
                break;
              case "error":
                setErrorCode((frame.data as { code?: string }).code ?? "UPSTREAM_ERROR");
                setState("error");
                break;
            }
          }
        }
        setState((s) => (s === "streaming" ? "done" : s));
      } catch {
        setErrorCode("NETWORK_ERROR");
        setState("error");
      } finally {
        runningRef.current = false;
      }
    },
    [],
  );

  return { state, progressMessage, chunks, result, errorCode, start };
}
