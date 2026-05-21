import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildSystem, MIN_CACHEABLE_TOKENS, stageModel } from "@/lib/anthropic";
import { LINT_THRESHOLDS } from "@/lib/prompts/lint-rules";
import {
  LINT_SYSTEM,
  LINT_SYSTEM_EST_TOKENS,
  DRIFT_SYSTEM_EST_TOKENS,
} from "@/lib/prompts/lint";
import {
  LINT_MODEL,
  LINT_RULE_IDS,
  LintDataSchema,
  LintRuleIdSchema,
  type DriftCheck,
  type LintIssue,
} from "@/lib/validation/lint";
import { ScriptDataSchema, type ScriptData } from "@/lib/validation/script";
import {
  applyAllFixes,
  applyIssueAction,
  InvalidActionError,
  IssueAlreadyResolvedError,
  IssueNotFoundError,
  NothingToApplyError,
  recomputeSummary,
  resolveApplyAll,
} from "@/lib/services/lint-mutations";
import { dropVoiceMismatch } from "@/lib/services/lint-anti-pattern";
import { extractOpening, passesDrift } from "@/lib/services/lint-script";
import { computeInputsHash } from "@/lib/services/lint";

// ── Stub builders ─────────────────────────────────────────────────────────────

function issue(overrides: Partial<LintIssue> = {}): LintIssue {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ruleId: "ai-tell/it-is-important-to-note",
    severity: "error",
    sectionIndex: 0,
    lineRange: { start: 0, end: 5 },
    excerpt: "x",
    message: "m",
    suggestedFix: "fix",
    accepted: false,
    dismissed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function driftStub(overrides: Partial<DriftCheck> = {}): DriftCheck {
  return {
    driftScore: 10,
    passed: true,
    semanticSimilarity: 0.9,
    confidence: 0.9,
    problem: null,
    missedDimensions: [],
    titlePromise: { titleText: "T", coreClaims: [] },
    scriptOpening: { wordCount: 50, detectedTopics: [], keywordFirstHit: null },
    ...overrides,
  };
}

function scriptStub(coldOpenText = "Cold open text."): ScriptData {
  return {
    targetMinutes: 8,
    lockedTitleIndex: 0,
    lockedHookIndex: 0,
    sections: [
      { index: 0, role: "cold_open", title: "COLD OPEN", startSec: 0, endSec: 16, paragraphs: [{ marker: null, text: coldOpenText, personalityPrompt: null }], brollCues: [], retentionRehook: null, predictedRetention: 80 },
      { index: 1, role: "promise", title: "THE PROMISE", startSec: 16, endSec: 46, paragraphs: [{ marker: null, text: "Here is the promise of the video.", personalityPrompt: null }], brollCues: [], retentionRehook: null, predictedRetention: 75 },
      { index: 2, role: "demonstration", title: "DEMO", startSec: 46, endSec: 200, paragraphs: [{ marker: null, text: "Watch this work end to end.", personalityPrompt: null }], brollCues: [], retentionRehook: null, predictedRetention: 70 },
      { index: 3, role: "loop_close", title: "LOOP CLOSE", startSec: 200, endSec: 260, paragraphs: [{ marker: null, text: "That is the whole trick.", personalityPrompt: null }], brollCues: [], retentionRehook: null, predictedRetention: 72 },
    ],
    rehookBeats: [],
    openLoops: [],
    retentionCurve: [
      { timeSec: 0, predicted: 90, riskFlag: "none" },
      { timeSec: 60, predicted: 70, riskFlag: "none" },
    ],
    totalWordCount: 100,
    estimatedRuntimeSec: 260,
    drift: { score: 10, problemDescription: null },
    formatViolationRetried: false,
    model: "claude-opus-4-7",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function lintData(issues: LintIssue[], drift: DriftCheck, overridden = false) {
  return {
    schemaVersion: 1 as const,
    issues,
    drift,
    summary: recomputeSummary(issues, drift, overridden),
    modelId: LINT_MODEL,
    scanWordCount: 100,
    scanDurationMs: 1000,
    promptTokensUsed: 10,
    outputTokensUsed: 10,
    cacheHit: false,
    generatedAt: new Date().toISOString(),
    inputsHash: "deadbeef",
    overridden,
  };
}

// ── Closed rule set ───────────────────────────────────────────────────────────

describe("LintRuleIdSchema — closed set", () => {
  it("matches the spec's enumerated contract (19 IDs; docs say 20 — off-by-one)", () => {
    expect(LINT_RULE_IDS).toHaveLength(19);
  });

  it("accepts every closed ID and rejects unknown ones", () => {
    for (const id of LINT_RULE_IDS) {
      expect(LintRuleIdSchema.safeParse(id).success).toBe(true);
    }
    expect(LintRuleIdSchema.safeParse("cliche/made-up").success).toBe(false);
    expect(LintRuleIdSchema.safeParse("totally/unknown").success).toBe(false);
  });
});

// ── LintData cross-checks ─────────────────────────────────────────────────────

describe("LintDataSchema — derived summary", () => {
  it("accepts a payload whose summary matches the issues + drift", () => {
    const data = lintData([issue({ severity: "error" })], driftStub());
    expect(LintDataSchema.safeParse(data).success).toBe(true);
    expect(data.summary).toMatchObject({ errors: 1, blocking: true });
  });

  it("rejects a tampered blocking flag", () => {
    const data = lintData([issue({ severity: "error" })], driftStub());
    data.summary.blocking = false; // lie: errors > 0 must block
    expect(LintDataSchema.safeParse(data).success).toBe(false);
  });

  it("rejects tampered severity counts", () => {
    const data = lintData([issue({ severity: "warning" })], driftStub());
    data.summary.errors = 5;
    expect(LintDataSchema.safeParse(data).success).toBe(false);
  });

  it("excludes dismissed issues from the counts", () => {
    const data = lintData(
      [issue({ severity: "error", dismissed: true })],
      driftStub(),
    );
    expect(data.summary.errors).toBe(0);
    expect(data.summary.blocking).toBe(false); // drift passed, no active errors
    expect(LintDataSchema.safeParse(data).success).toBe(true);
  });
});

// ── Apply-all conflict resolution (§5.8) ──────────────────────────────────────

describe("resolveApplyAll — §5.8 conflict resolution", () => {
  it("keeps non-overlapping A+B and dismisses overlapping C (spec worked example)", () => {
    const a = issue({ sectionIndex: 2, lineRange: { start: 10, end: 35 }, suggestedFix: "ALPHA" });
    const b = issue({ sectionIndex: 2, lineRange: { start: 50, end: 80 }, suggestedFix: "BETA" });
    const c = issue({ sectionIndex: 2, lineRange: { start: 60, end: 90 }, suggestedFix: "GAMMA" });
    const plan = resolveApplyAll([a, b, c]);
    expect(plan.acceptedIds).toEqual([a.id, b.id]);
    expect(plan.dismissedIds).toEqual([c.id]);
  });

  it("a fully-overlapping triple yields 1 accepted + 2 dismissed", () => {
    const a = issue({ sectionIndex: 0, lineRange: { start: 10, end: 50 }, suggestedFix: "A" });
    const b = issue({ sectionIndex: 0, lineRange: { start: 20, end: 40 }, suggestedFix: "B" });
    const c = issue({ sectionIndex: 0, lineRange: { start: 30, end: 45 }, suggestedFix: "C" });
    const plan = resolveApplyAll([a, b, c]);
    expect(plan.acceptedIds).toHaveLength(1);
    expect(plan.dismissedIds).toHaveLength(2);
    expect(plan.acceptedIds).toEqual([a.id]);
  });

  it("excludes drift, global, and null-suggestedFix issues", () => {
    const drift = issue({ ruleId: "drift/title-promise-not-met-by-2min", sectionIndex: -1, suggestedFix: null });
    const global = issue({ ruleId: "seo/keyword-once", sectionIndex: -1, suggestedFix: "advice" });
    const noFix = issue({ sectionIndex: 1, suggestedFix: null });
    const plan = resolveApplyAll([drift, global, noFix]);
    expect(plan.acceptedIds).toHaveLength(0);
    expect(plan.dismissedIds).toHaveLength(0);
  });
});

// ── Single accept / dismiss ───────────────────────────────────────────────────

describe("applyIssueAction", () => {
  const script = scriptStub("Now, it is important to note that this matters.");

  it("rejects accept on a drift issue (400)", () => {
    const drift = issue({ ruleId: "drift/title-promise-not-met-by-2min", sectionIndex: -1, suggestedFix: null });
    expect(() => applyIssueAction([drift], script, drift.id, "accept")).toThrow(
      InvalidActionError,
    );
  });

  it("allows dismiss on a drift issue", () => {
    const drift = issue({ ruleId: "drift/title-promise-not-met-by-2min", sectionIndex: -1, suggestedFix: null });
    const res = applyIssueAction([drift], script, drift.id, "dismiss");
    expect(res.issues[0]!.dismissed).toBe(true);
    expect(res.scriptPatched).toBe(false);
  });

  it("patches the script when accepting a locatable section fix", () => {
    const i = issue({
      sectionIndex: 0,
      excerpt: "it is important to note that",
      suggestedFix: "here's the catch:",
    });
    const res = applyIssueAction([i], script, i.id, "accept");
    expect(res.scriptPatched).toBe(true);
    expect(res.issues[0]!.accepted).toBe(true);
    expect(res.script.sections[0]!.paragraphs[0]!.text).toContain("here's the catch:");
    expect(res.script.sections[0]!.paragraphs[0]!.text).not.toContain(
      "it is important to note that",
    );
  });

  it("throws on an unknown issue id", () => {
    expect(() => applyIssueAction([], script, randomUUID(), "accept")).toThrow(
      IssueNotFoundError,
    );
  });

  it("throws when the issue is already resolved", () => {
    const i = issue({ accepted: true });
    expect(() => applyIssueAction([i], script, i.id, "dismiss")).toThrow(
      IssueAlreadyResolvedError,
    );
  });
});

describe("applyAllFixes", () => {
  it("accepts the eligible non-conflicting fixes and re-validates the script", () => {
    const script = scriptStub("alpha beta gamma delta.");
    const a = issue({ sectionIndex: 0, lineRange: { start: 0, end: 5 }, excerpt: "alpha", suggestedFix: "ALPHA" });
    const b = issue({ sectionIndex: 0, lineRange: { start: 11, end: 16 }, excerpt: "gamma", suggestedFix: "GAMMA" });
    const res = applyAllFixes([a, b], script);
    expect(res.acceptedCount).toBe(2);
    expect(res.skippedCount).toBe(0);
    expect(res.scriptPatched).toBe(true);
    expect(ScriptDataSchema.safeParse(res.script).success).toBe(true);
  });

  it("throws NothingToApplyError when no issue is eligible", () => {
    const drift = issue({ ruleId: "drift/title-promise-not-met-by-2min", sectionIndex: -1, suggestedFix: null });
    expect(() => applyAllFixes([drift], scriptStub())).toThrow(NothingToApplyError);
  });
});

// ── Summary derivation + override ─────────────────────────────────────────────

describe("recomputeSummary", () => {
  it("counts only non-dismissed issues", () => {
    const s = recomputeSummary(
      [issue({ severity: "warning" }), issue({ severity: "warning", dismissed: true })],
      driftStub(),
      false,
    );
    expect(s.warnings).toBe(1);
  });

  it("blocks on an error or on failed drift, and an override clears it", () => {
    expect(recomputeSummary([issue({ severity: "error" })], driftStub(), false).blocking).toBe(true);
    expect(recomputeSummary([], driftStub({ passed: false }), false).blocking).toBe(true);
    expect(recomputeSummary([issue({ severity: "error" })], driftStub(), true).blocking).toBe(false);
  });
});

// ── Drift threshold ───────────────────────────────────────────────────────────

describe("drift threshold", () => {
  it("passes at 40 and fails at 41", () => {
    expect(LINT_THRESHOLDS.DRIFT_PASS_THRESHOLD).toBe(40);
    expect(passesDrift(40)).toBe(true);
    expect(passesDrift(41)).toBe(false);
  });
});

// ── extractOpening ────────────────────────────────────────────────────────────

describe("extractOpening", () => {
  it("returns the whole body when 25% is below the 250-word floor", () => {
    const { wordCount } = extractOpening(scriptStub());
    expect(wordCount).toBe(scriptStub().sections.map((s) => s.paragraphs.map((p) => p.text).join(" ")).join(" ").split(/\s+/).filter(Boolean).length);
  });

  it("caps the opening at 1500 words", () => {
    const big = scriptStub();
    // 8000 words in the body pushes 25% (~2000) over the 1500-word cap.
    big.sections[2]!.paragraphs = [
      { marker: null, text: Array(8000).fill("word").join(" "), personalityPrompt: null },
    ];
    const { wordCount } = extractOpening(big);
    expect(wordCount).toBe(LINT_THRESHOLDS.DRIFT_OPENING_MAX_WORDS);
  });
});

// ── tone/voice-mismatch gating ────────────────────────────────────────────────

describe("dropVoiceMismatch", () => {
  it("removes voice-mismatch when the channel has <10 top videos", () => {
    const issues = [issue({ ruleId: "tone/voice-mismatch", sectionIndex: -1, suggestedFix: null }), issue()];
    expect(dropVoiceMismatch(issues, false)).toHaveLength(1);
    expect(dropVoiceMismatch(issues, true)).toHaveLength(2);
  });
});

// ── CRIT-2 model routing + CRIT-3 cache ───────────────────────────────────────

describe("model routing + prompt cache", () => {
  it("routes lint to Haiku 4.5 (CRIT-2)", () => {
    expect(stageModel.lint).toBe("claude-haiku-4-5-20251001");
    expect(stageModel.lint).toBe(LINT_MODEL);
  });

  it("both lint prompts are large enough to be cached (CRIT-3)", () => {
    expect(LINT_SYSTEM_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    expect(DRIFT_SYSTEM_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    const block = buildSystem(LINT_SYSTEM, LINT_SYSTEM_EST_TOKENS)[0]!;
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });
});

// ── inputsHash dedup mechanism ────────────────────────────────────────────────

describe("computeInputsHash", () => {
  it("is stable for identical inputs and sensitive to a title change", () => {
    const script = scriptStub();
    const base = { script, chosenTitle: "T", chosenHook: "H" };
    expect(computeInputsHash(base)).toBe(
      computeInputsHash({ script, chosenTitle: "T", chosenHook: "H" }),
    );
    expect(computeInputsHash(base)).not.toBe(
      computeInputsHash({ ...base, chosenTitle: "Different" }),
    );
  });
});
