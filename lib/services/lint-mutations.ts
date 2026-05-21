import "server-only";

import {
  ScriptDataSchema,
  ScriptParagraphSchema,
  type ScriptData,
} from "@/lib/validation/script";
import {
  isDriftRule,
  type DriftCheck,
  type LintIssue,
  type LintSummary,
} from "@/lib/validation/lint";

// ── Summary ─────────────────────────────────────────────────────────────────

// Counts are over NON-dismissed issues; blocking is derived and forced false
// only by an explicit override (spec §4.2, §7.5).
export function recomputeSummary(
  issues: LintIssue[],
  drift: DriftCheck,
  overridden: boolean,
): LintSummary {
  const active = issues.filter((i) => !i.dismissed);
  const errors = active.filter((i) => i.severity === "error").length;
  const warnings = active.filter((i) => i.severity === "warning").length;
  const infos = active.filter((i) => i.severity === "info").length;
  const rawBlocking = errors > 0 || !drift.passed;
  return { errors, warnings, infos, blocking: overridden ? false : rawBlocking };
}

// ── Apply-all conflict resolution (§5.8) ─────────────────────────────────────

function overlaps(a: LintIssue, b: LintIssue): boolean {
  if (a.sectionIndex !== b.sectionIndex) return false;
  // Half-open interval overlap; empty ranges (start==end) never overlap.
  return (
    a.lineRange.start < b.lineRange.end && b.lineRange.start < a.lineRange.end
  );
}

export type ApplyAllPlan = {
  acceptedIds: string[];
  dismissedIds: string[]; // conflict-skipped
};

// Pure: given the issue list, decide which open, fixable issues get accepted
// and which are dismissed for conflicting with an already-accepted range.
// Sort by lineRange.start ascending, greedily accept, dismiss on overlap with
// a previously-accepted issue's original range in the same section.
export function resolveApplyAll(issues: LintIssue[]): ApplyAllPlan {
  const eligible = issues
    .filter(
      (i) =>
        !i.accepted &&
        !i.dismissed &&
        i.suggestedFix !== null &&
        !isDriftRule(i.ruleId) &&
        i.sectionIndex >= 0,
    )
    .sort((a, b) => a.lineRange.start - b.lineRange.start);

  const accepted: LintIssue[] = [];
  const acceptedIds: string[] = [];
  const dismissedIds: string[] = [];

  for (const issue of eligible) {
    if (accepted.some((a) => overlaps(a, issue))) {
      dismissedIds.push(issue.id);
    } else {
      accepted.push(issue);
      acceptedIds.push(issue.id);
    }
  }
  return { acceptedIds, dismissedIds };
}

// ── Excerpt-anchored script patching ─────────────────────────────────────────

// Replace the first occurrence of the issue's verbatim excerpt with its
// suggestedFix inside the owning section's paragraph. Anchoring on the excerpt
// (rather than char offsets into a join) is robust to the paragraph structure.
// Returns the (possibly unchanged) script and whether a patch was applied.
export function applyExcerptFix(
  script: ScriptData,
  issue: LintIssue,
): { script: ScriptData; patched: boolean } {
  if (
    issue.sectionIndex < 0 ||
    issue.suggestedFix === null ||
    isDriftRule(issue.ruleId)
  ) {
    return { script, patched: false };
  }

  const section = script.sections.find((s) => s.index === issue.sectionIndex);
  if (!section) return { script, patched: false };

  const paraIndex = section.paragraphs.findIndex((p) =>
    p.text.includes(issue.excerpt),
  );
  if (paraIndex < 0) return { script, patched: false };

  const target = section.paragraphs[paraIndex]!;
  const nextText = target.text.replace(issue.excerpt, issue.suggestedFix);
  const nextPara = ScriptParagraphSchema.safeParse({
    ...target,
    text: nextText,
  });
  if (!nextPara.success) return { script, patched: false };

  const nextScript: ScriptData = {
    ...script,
    sections: script.sections.map((s) =>
      s.index === section.index
        ? {
            ...s,
            paragraphs: s.paragraphs.map((p, i) =>
              i === paraIndex ? nextPara.data : p,
            ),
          }
        : s,
    ),
  };
  return { script: nextScript, patched: true };
}

// ── Single accept / dismiss ──────────────────────────────────────────────────

export class IssueNotFoundError extends Error {
  constructor() {
    super("issue not found");
    this.name = "IssueNotFoundError";
  }
}
export class IssueAlreadyResolvedError extends Error {
  constructor() {
    super("issue already accepted or dismissed");
    this.name = "IssueAlreadyResolvedError";
  }
}
export class InvalidActionError extends Error {
  constructor(message = "invalid action for this issue") {
    super(message);
    this.name = "InvalidActionError";
  }
}
export class NothingToApplyError extends Error {
  constructor() {
    super("no eligible issues to apply");
    this.name = "NothingToApplyError";
  }
}
export class PatchValidationError extends Error {
  constructor() {
    super("patched script failed validation; rolled back");
    this.name = "PatchValidationError";
  }
}

export type IssueActionResult = {
  issues: LintIssue[];
  script: ScriptData;
  scriptPatched: boolean;
};

// Mutate one issue in-list (accept or dismiss) and patch the script when an
// accept is physically applicable. Drift accepts are rejected (400); global
// advisory accepts mark the issue accepted without a script patch.
export function applyIssueAction(
  issues: LintIssue[],
  script: ScriptData,
  issueId: string,
  action: "accept" | "dismiss",
): IssueActionResult {
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) throw new IssueNotFoundError();
  if (issue.accepted || issue.dismissed) throw new IssueAlreadyResolvedError();

  const now = new Date().toISOString();

  if (action === "dismiss") {
    const next = issues.map((i) =>
      i.id === issueId ? { ...i, dismissed: true, updatedAt: now } : i,
    );
    return { issues: next, script, scriptPatched: false };
  }

  // action === "accept"
  if (isDriftRule(issue.ruleId)) {
    throw new InvalidActionError("drift issues require a Stage 7 re-run");
  }

  const { script: nextScript, patched } = applyExcerptFix(script, issue);
  const next = issues.map((i) =>
    i.id === issueId ? { ...i, accepted: true, updatedAt: now } : i,
  );
  return { issues: next, script: nextScript, scriptPatched: patched };
}

// ── Apply-all ────────────────────────────────────────────────────────────────

export type ApplyAllResult = {
  issues: LintIssue[];
  script: ScriptData;
  acceptedCount: number;
  skippedCount: number;
  scriptPatched: boolean;
};

export function applyAllFixes(
  issues: LintIssue[],
  script: ScriptData,
): ApplyAllResult {
  const openCount = issues.filter((i) => !i.accepted && !i.dismissed).length;
  const plan = resolveApplyAll(issues);
  if (plan.acceptedIds.length === 0) throw new NothingToApplyError();

  const now = new Date().toISOString();
  const acceptedSet = new Set(plan.acceptedIds);
  const dismissedSet = new Set(plan.dismissedIds);

  // Apply patches in descending start-offset order so earlier patches don't
  // shift later excerpts; excerpt-anchoring makes this order-independent in
  // practice, but we honor the spec's ordering for determinism.
  const toApply = issues
    .filter((i) => acceptedSet.has(i.id))
    .sort((a, b) => b.lineRange.start - a.lineRange.start);

  let nextScript = script;
  let scriptPatched = false;
  for (const issue of toApply) {
    const res = applyExcerptFix(nextScript, issue);
    nextScript = res.script;
    scriptPatched = scriptPatched || res.patched;
  }

  // Re-validate the merged script; on failure roll back (caller persists
  // nothing).
  if (scriptPatched && !ScriptDataSchema.safeParse(nextScript).success) {
    throw new PatchValidationError();
  }

  const nextIssues = issues.map((i) => {
    if (acceptedSet.has(i.id)) return { ...i, accepted: true, updatedAt: now };
    if (dismissedSet.has(i.id)) return { ...i, dismissed: true, updatedAt: now };
    return i;
  });

  return {
    issues: nextIssues,
    script: nextScript,
    acceptedCount: plan.acceptedIds.length,
    skippedCount: openCount - plan.acceptedIds.length,
    scriptPatched,
  };
}
