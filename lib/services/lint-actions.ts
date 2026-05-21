import "server-only";

import type { Database } from "@/lib/db/types";
import { readLintData, writeLintData } from "@/lib/db/lint";
import { readScriptData, writeScriptData } from "@/lib/db/script";
import { publish } from "@/lib/services/pipeline-bus";
import type { LintData, LintIssue, LintSummary } from "@/lib/validation/lint";
import { computeInputsHash, resolveLintInputs } from "./lint";
import {
  applyAllFixes,
  applyIssueAction,
  recomputeSummary,
  IssueNotFoundError,
  IssueAlreadyResolvedError,
  InvalidActionError,
  NothingToApplyError,
  PatchValidationError,
} from "./lint-mutations";
import { LintDataSchema } from "@/lib/validation/lint";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

export class NoChangesError extends Error {
  constructor() {
    super("inputs unchanged since the last lint");
    this.name = "NoChangesError";
  }
}

// Re-exported (as local bindings) so the route layer can map them to HTTP codes.
export {
  IssueNotFoundError,
  IssueAlreadyResolvedError,
  InvalidActionError,
  NothingToApplyError,
  PatchValidationError,
};

// True when the stored lint already reflects the current script+title+hook.
// The manual re-run route returns NO_CHANGES (409) in this case unless forced.
export function isLintFresh(run: RunRow): boolean {
  const inputs = resolveLintInputs(run);
  if (!inputs) return false;
  const existing = LintDataSchema.safeParse(run.lint_data);
  if (!existing.success) return false;
  return existing.data.inputsHash === computeInputsHash(inputs);
}

type Ownership = { runId: string; userId: string };

async function persistScript(
  args: Ownership,
  script: Parameters<typeof writeScriptData>[1],
): Promise<void> {
  await writeScriptData(
    {
      ...args,
      targetMinutes: script.targetMinutes,
      lockedTitleIndex: script.lockedTitleIndex,
      lockedHookIndex: script.lockedHookIndex,
    },
    script,
  );
}

export type IssueActionOutcome = {
  issue: LintIssue;
  summary: LintSummary;
  scriptPatched: boolean;
};

// Accept or dismiss a single issue. Accept patches the script when the fix is
// physically applicable (spec §4.2). inputsHash is intentionally left stale on
// an accept-patch — that mismatch is the run-detail "lint outdated" signal.
export async function acceptOrDismissIssue(args: {
  runId: string;
  userId: string;
  issueId: string;
  action: "accept" | "dismiss";
}): Promise<IssueActionOutcome> {
  const lint = await readLintData({ runId: args.runId, userId: args.userId });
  if (!lint) throw new IssueNotFoundError();
  const script = await readScriptData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!script) throw new IssueNotFoundError();

  const res = applyIssueAction(lint.issues, script, args.issueId, args.action);
  const summary = recomputeSummary(res.issues, lint.drift, lint.overridden);
  const nextLint: LintData = { ...lint, issues: res.issues, summary };

  await writeLintData({ runId: args.runId, userId: args.userId }, nextLint);
  if (res.scriptPatched) {
    await persistScript(
      { runId: args.runId, userId: args.userId },
      res.script,
    );
  }
  await publish(args.runId, { event: "stage_complete", payload: { stage: 8 } });

  const issue = res.issues.find((i) => i.id === args.issueId)!;
  return { issue, summary, scriptPatched: res.scriptPatched };
}

export type ApplyAllOutcome = {
  acceptedCount: number;
  skippedCount: number;
  summary: LintSummary;
  scriptPatched: boolean;
};

export async function applyAll(args: Ownership): Promise<ApplyAllOutcome> {
  const lint = await readLintData(args);
  const script = await readScriptData(args);
  if (!lint || !script) throw new NothingToApplyError();

  const res = applyAllFixes(lint.issues, script);
  const summary = recomputeSummary(res.issues, lint.drift, lint.overridden);
  const nextLint: LintData = { ...lint, issues: res.issues, summary };

  await writeLintData(args, nextLint);
  if (res.scriptPatched) await persistScript(args, res.script);
  await publish(args.runId, { event: "stage_complete", payload: { stage: 8 } });

  return {
    acceptedCount: res.acceptedCount,
    skippedCount: res.skippedCount,
    summary,
    scriptPatched: res.scriptPatched,
  };
}

// Override the blocking gate (spec §7.5). Flips summary.blocking false and
// records overridden=true; the persistent warning banner stays. No audit_log
// column exists yet, so the reason is logged server-side only.
export async function overrideLint(args: {
  runId: string;
  userId: string;
  reason?: string;
}): Promise<{ lintData: LintData }> {
  const lint = await readLintData({ runId: args.runId, userId: args.userId });
  if (!lint) throw new IssueNotFoundError();

  const summary = recomputeSummary(lint.issues, lint.drift, true);
  const nextLint: LintData = { ...lint, overridden: true, summary };

  await writeLintData({ runId: args.runId, userId: args.userId }, nextLint);
  console.warn(
    `[lint:override] run=${args.runId} reason=${(args.reason ?? "").slice(0, 200)}`,
  );
  await publish(args.runId, { event: "stage_complete", payload: { stage: 8 } });
  return { lintData: nextLint };
}

// Advisory skip: the auto-chain already advanced past lint, so this only nudges
// the run-detail UI to drop the error/empty lint card. lint_data stays null.
export async function skipLint(args: Ownership): Promise<void> {
  await publish(args.runId, { event: "stage_complete", payload: { stage: 8 } });
}
