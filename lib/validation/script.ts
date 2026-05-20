import { z } from "zod";

export const SCRIPT_MODEL = "claude-opus-4-7";
export const SCRIPT_WPM = 150;
export const DRIFT_PASS_THRESHOLD = 40;
export const SCRIPT_TARGET_MINUTES = [5, 8, 12, 20] as const;
export type ScriptTargetMinutes = (typeof SCRIPT_TARGET_MINUTES)[number];

export const ScriptTargetMinutesSchema = z.union([
  z.literal(5),
  z.literal(8),
  z.literal(12),
  z.literal(20),
]);

export const SectionRoleSchema = z.enum([
  "cold_open",
  "promise",
  "setup",
  "demonstration",
  "payoff",
  "loop_close",
]);
export type SectionRole = z.infer<typeof SectionRoleSchema>;

export const ScriptParagraphSchema = z.object({
  // null = plain narration; 'skeleton' = keep verbatim; 'personality' = inject voice.
  marker: z.enum(["skeleton", "personality"]).nullable(),
  text: z.string().min(1).max(1200),
  personalityPrompt: z.string().max(280).nullable(),
});
export type ScriptParagraph = z.infer<typeof ScriptParagraphSchema>;

export const BrollCueSchema = z.object({
  atSec: z.number().int().nonnegative(),
  cue: z.string().min(1).max(300),
});
export type BrollCue = z.infer<typeof BrollCueSchema>;

export const ScriptSectionSchema = z.object({
  index: z.number().int().min(0).max(9),
  role: SectionRoleSchema,
  title: z.string().min(1).max(60),
  startSec: z.number().int().nonnegative(),
  endSec: z.number().int().nonnegative(),
  paragraphs: z.array(ScriptParagraphSchema).min(1).max(10),
  brollCues: z.array(BrollCueSchema).max(6),
  retentionRehook: z.string().min(1).max(280).nullable(),
  predictedRetention: z.number().int().min(0).max(100),
});
export type ScriptSection = z.infer<typeof ScriptSectionSchema>;

export const RetentionSampleSchema = z.object({
  timeSec: z.number().int().nonnegative(),
  predicted: z.number().int().min(0).max(100),
  riskFlag: z.enum(["none", "rehook_gap", "topic_pivot", "demo_density"]),
});
export type RetentionSample = z.infer<typeof RetentionSampleSchema>;

export const OpenLoopSchema = z.object({
  id: z.string().regex(/^loop-[1-9][0-9]?$/),
  setupSectionIndex: z.number().int().min(0).max(9),
  payoffSectionIndex: z.number().int().min(0).max(9),
  description: z.string().min(1).max(120),
  anchorSubstring: z.string().min(1).max(160),
});
export type OpenLoop = z.infer<typeof OpenLoopSchema>;

export const RehookBeatSchema = z.object({
  afterSectionIndex: z.number().int().min(0).max(9),
  atSec: z.number().int().nonnegative(),
  text: z.string().min(1).max(280),
});
export type RehookBeat = z.infer<typeof RehookBeatSchema>;

export const ScriptDriftSchema = z.object({
  score: z.number().int().min(0).max(100),
  problemDescription: z.string().max(600).nullable(),
});
export type ScriptDrift = z.infer<typeof ScriptDriftSchema>;

export const ScriptDataSchema = z.object({
  targetMinutes: ScriptTargetMinutesSchema,
  lockedTitleIndex: z.number().int().min(0).max(2),
  lockedHookIndex: z.number().int().min(0).max(2),
  sections: z.array(ScriptSectionSchema).min(4).max(10),
  rehookBeats: z.array(RehookBeatSchema).max(12),
  openLoops: z.array(OpenLoopSchema).max(6),
  retentionCurve: z.array(RetentionSampleSchema).min(2),
  totalWordCount: z.number().int().nonnegative(),
  estimatedRuntimeSec: z.number().int().nonnegative(),
  drift: ScriptDriftSchema,
  formatViolationRetried: z.boolean(),
  model: z.literal(SCRIPT_MODEL),
  generatedAt: z.string(),
  schemaVersion: z.literal(1),
});
export type ScriptData = z.infer<typeof ScriptDataSchema>;

// Deterministic section taxonomy. The model fills these exact sections — it
// cannot add or remove them (spec §5.1). Word counts ≈ targetMinutes × 150 WPM.
export type SectionTemplate = {
  role: SectionRole;
  title: string;
  approxWords: number;
  approxSec: number;
};

export const SCRIPT_SECTION_TEMPLATES: Record<
  ScriptTargetMinutes,
  SectionTemplate[]
> = {
  5: [
    { role: "cold_open", title: "COLD OPEN", approxWords: 40, approxSec: 16 },
    { role: "promise", title: "THE PROMISE", approxWords: 90, approxSec: 36 },
    { role: "demonstration", title: "DEMONSTRATION", approxWords: 470, approxSec: 188 },
    { role: "loop_close", title: "PAYOFF & LOOP CLOSE", approxWords: 150, approxSec: 60 },
  ],
  8: [
    { role: "cold_open", title: "COLD OPEN", approxWords: 40, approxSec: 16 },
    { role: "promise", title: "THE PROMISE", approxWords: 75, approxSec: 30 },
    { role: "setup", title: "SETUP", approxWords: 113, approxSec: 45 },
    { role: "demonstration", title: "DEMONSTRATION", approxWords: 375, approxSec: 150 },
    { role: "payoff", title: "PAYOFF", approxWords: 447, approxSec: 179 },
    { role: "loop_close", title: "LOOP CLOSE", approxWords: 150, approxSec: 60 },
  ],
  12: [
    { role: "cold_open", title: "COLD OPEN", approxWords: 40, approxSec: 16 },
    { role: "promise", title: "THE PROMISE", approxWords: 75, approxSec: 30 },
    { role: "setup", title: "SETUP", approxWords: 188, approxSec: 75 },
    { role: "demonstration", title: "DEMONSTRATION I", approxWords: 600, approxSec: 240 },
    { role: "demonstration", title: "DEMONSTRATION II", approxWords: 450, approxSec: 180 },
    { role: "payoff", title: "PAYOFF", approxWords: 300, approxSec: 120 },
    { role: "loop_close", title: "LOOP CLOSE", approxWords: 150, approxSec: 60 },
  ],
  20: [
    { role: "cold_open", title: "COLD OPEN", approxWords: 40, approxSec: 16 },
    { role: "promise", title: "THE PROMISE", approxWords: 113, approxSec: 45 },
    { role: "setup", title: "SETUP", approxWords: 300, approxSec: 120 },
    { role: "demonstration", title: "DEMONSTRATION I", approxWords: 750, approxSec: 300 },
    { role: "demonstration", title: "DEMONSTRATION II", approxWords: 750, approxSec: 300 },
    { role: "demonstration", title: "DEMONSTRATION III", approxWords: 600, approxSec: 240 },
    { role: "payoff", title: "PAYOFF", approxWords: 300, approxSec: 120 },
    { role: "loop_close", title: "LOOP CLOSE", approxWords: 150, approxSec: 60 },
  ],
};

export function sectionCountFor(targetMinutes: ScriptTargetMinutes): number {
  return SCRIPT_SECTION_TEMPLATES[targetMinutes].length;
}

// Whitespace-normalize for verbatim cold-open comparison (spec §3.4).
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
