"use client";

import { useCallback, useState } from "react";

// Client actions for the Stage 8 lint card. Each call hits a JSON route; the
// route persists and publishes a `stage_complete` event, which useRun observes
// and turns into a run re-fetch — so the card re-renders from fresh lint_data
// without this hook holding its own copy. We track per-issue pending + a
// top-level busy flag for button states only.

type LintAction =
  | { kind: "issue"; issueId: string; action: "accept" | "dismiss" }
  | { kind: "apply-all" }
  | { kind: "rerun"; force?: boolean }
  | { kind: "skip" }
  | { kind: "override"; reason?: string }
  | { kind: "run" };

const PATHS: Record<LintAction["kind"], string> = {
  issue: "/api/pipeline/lint/issue",
  "apply-all": "/api/pipeline/lint/apply-all",
  rerun: "/api/pipeline/lint/rerun",
  skip: "/api/pipeline/lint/skip",
  override: "/api/pipeline/lint/override",
  run: "/api/pipeline/lint",
};

export type UseLintResult = {
  pending: Set<string>;
  busy: boolean;
  error: string | null;
  acceptIssue: (issueId: string) => Promise<void>;
  dismissIssue: (issueId: string) => Promise<void>;
  applyAll: () => Promise<void>;
  rerun: (force?: boolean) => Promise<void>;
  skip: () => Promise<void>;
  override: (reason?: string) => Promise<void>;
  runLint: () => Promise<void>;
};

export function useLint(runId: string): UseLintResult {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (action: LintAction): Promise<void> => {
      setError(null);
      const body: Record<string, unknown> = { runId };
      if (action.kind === "issue") {
        body.issueId = action.issueId;
        body.action = action.action;
      } else if (action.kind === "rerun" && action.force) {
        body.force = true;
      } else if (action.kind === "override" && action.reason) {
        body.reason = action.reason;
      }

      const res = await fetch(PATHS[action.kind], {
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
    [runId],
  );

  const withPending = useCallback(
    async (issueId: string, action: "accept" | "dismiss"): Promise<void> => {
      setPending((prev) => new Set(prev).add(issueId));
      try {
        await send({ kind: "issue", issueId, action });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(issueId);
          return next;
        });
      }
    },
    [send],
  );

  const withBusy = useCallback(
    async (action: LintAction): Promise<void> => {
      setBusy(true);
      try {
        await send(action);
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  return {
    pending,
    busy,
    error,
    acceptIssue: (issueId) => withPending(issueId, "accept"),
    dismissIssue: (issueId) => withPending(issueId, "dismiss"),
    applyAll: () => withBusy({ kind: "apply-all" }),
    rerun: (force) => withBusy({ kind: "rerun", force }),
    skip: () => withBusy({ kind: "skip" }),
    override: (reason) => withBusy({ kind: "override", reason }),
    runLint: () => withBusy({ kind: "run" }),
  };
}
