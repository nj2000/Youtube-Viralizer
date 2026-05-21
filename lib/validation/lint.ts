import { z } from "zod";

// CRIT-2: Stage 8 is pattern-matching, not reasoning — both passes use Haiku.
export const LINT_MODEL = "claude-haiku-4-5-20251001";

export const LintSeveritySchema = z.enum(["error", "warning", "info"]);
export type LintSeverity = z.infer<typeof LintSeveritySchema>;

// Closed rule set (spec §3.3). The enumerated contract is these IDs — the
// spec/task label them "20" but the literal enum lists 19; we implement the
// exact enum and treat the count as off-by-one in the prose (see summary.md).
// schemaVersion 1 hard-codes this set; expanding the set bumps the version.
export const LintRuleIdSchema = z.enum([
  // Cliché filler intros
  "cliche/welcome-back",
  "cliche/dont-forget-to-subscribe",
  "cliche/in-this-video",
  // AI tells (model-authored phrasing that signals an LLM wrote it)
  "ai-tell/it-is-important-to-note",
  "ai-tell/excessive-em-dash",
  "ai-tell/delve-into",
  "ai-tell/in-conclusion",
  // Hostage engagement
  "hostage-engagement/like-and-subscribe-or-else",
  // Keyword stuffing
  "keyword-vomit/repeated-primary-keyword",
  // Pacing
  "pacing/over-15s-without-cut",
  "pacing/wall-of-text",
  // Drift
  "drift/title-promise-not-met-by-2min",
  "drift/topic-shift-mid-section",
  // SEO
  "seo/keyword-once",
  // Retention
  "retention/no-rehook-at-section-break",
  "retention/missing-loop-payoff",
  // Hook structure
  "hook/over-30s",
  // Script structure
  "structure/missing-cold-open-marker",
  // Voice
  "tone/voice-mismatch",
]);
export type LintRuleId = z.infer<typeof LintRuleIdSchema>;

export const LINT_RULE_IDS = LintRuleIdSchema.options;

export function isDriftRule(ruleId: LintRuleId): boolean {
  return ruleId.startsWith("drift/");
}

export const LintLineRangeSchema = z
  .object({
    // char offsets within the section's joined paragraph text; (0,0) = global
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((r) => r.end >= r.start, { message: "end must be ≥ start" });
export type LintLineRange = z.infer<typeof LintLineRangeSchema>;

export const LintIssueSchema = z.object({
  id: z.string().uuid(), // server-generated; stable across re-renders
  ruleId: LintRuleIdSchema,
  severity: LintSeveritySchema,
  sectionIndex: z.number().int().min(-1), // -1 for global rules
  lineRange: LintLineRangeSchema,
  excerpt: z.string().min(1).max(500), // offending text, verbatim
  message: z.string().min(1).max(280),
  suggestedFix: z.string().min(1).max(2000).nullable(),
  accepted: z.boolean(),
  dismissed: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LintIssue = z.infer<typeof LintIssueSchema>;

export const DriftDimensionSchema = z.enum([
  "subject",
  "specificity",
  "outcome",
  "personal",
  "delivery-time",
]);
export type DriftDimension = z.infer<typeof DriftDimensionSchema>;

export const DriftCheckSchema = z.object({
  driftScore: z.number().int().min(0).max(100), // 0 = perfect alignment
  passed: z.boolean(), // driftScore ≤ DRIFT_PASS_THRESHOLD
  semanticSimilarity: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  problem: z.string().max(800).nullable(), // populated when driftScore > 40
  missedDimensions: z.array(DriftDimensionSchema).max(5),
  titlePromise: z.object({
    titleText: z.string().min(1).max(500),
    coreClaims: z.array(z.string().min(1).max(200)).max(5),
  }),
  scriptOpening: z.object({
    wordCount: z.number().int().nonnegative(),
    detectedTopics: z.array(z.string().min(1).max(200)).max(5),
    keywordFirstHit: z.number().int().nullable(), // word index of first hit
  }),
});
export type DriftCheck = z.infer<typeof DriftCheckSchema>;

export const LintSummarySchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  infos: z.number().int().nonnegative(),
  blocking: z.boolean(), // derived: errors > 0 OR !drift.passed
});
export type LintSummary = z.infer<typeof LintSummarySchema>;

export const LintDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    issues: z.array(LintIssueSchema).max(200),
    drift: DriftCheckSchema,
    summary: LintSummarySchema,
    modelId: z.literal(LINT_MODEL),
    scanWordCount: z.number().int().nonnegative(),
    scanDurationMs: z.number().int().nonnegative(),
    promptTokensUsed: z.number().int().nonnegative(),
    outputTokensUsed: z.number().int().nonnegative(),
    cacheHit: z.boolean(),
    generatedAt: z.string().datetime(),
    inputsHash: z.string().min(8).max(128),
    // True when the user has overridden the blocking gate (spec §7.5). The
    // override flips summary.blocking false but we record that it was forced.
    overridden: z.boolean(),
  })
  .superRefine((data, ctx) => {
    // Counts are over NON-dismissed issues (dismissed are kept for audit but
    // excluded from totals — spec §4.2).
    const active = data.issues.filter((i) => !i.dismissed);
    const errors = active.filter((i) => i.severity === "error").length;
    const warnings = active.filter((i) => i.severity === "warning").length;
    const infos = active.filter((i) => i.severity === "info").length;
    if (
      data.summary.errors !== errors ||
      data.summary.warnings !== warnings ||
      data.summary.infos !== infos
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "summary counts must match non-dismissed issue severities",
        path: ["summary"],
      });
    }
    // blocking is derived; an override is the only way it diverges from the
    // raw (errors>0 || !drift.passed) signal.
    const rawBlocking = errors > 0 || !data.drift.passed;
    const expected = data.overridden ? false : rawBlocking;
    if (data.summary.blocking !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "summary.blocking must equal (errors>0 || !drift.passed) unless overridden",
        path: ["summary", "blocking"],
      });
    }
  });
export type LintData = z.infer<typeof LintDataSchema>;
