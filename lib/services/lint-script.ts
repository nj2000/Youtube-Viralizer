import "server-only";

import { LINT_THRESHOLDS } from "@/lib/prompts/lint-rules";
import type { ScriptData, ScriptSection } from "@/lib/validation/script";

// The Stage 7 script is paragraph-structured (sections[].paragraphs[].text),
// not a flat content string. Lint treats each section's joined paragraph text
// as its "content"; lineRange offsets and excerpts are computed against this
// joined string, and fix-application re-anchors on the verbatim excerpt.
export const PARAGRAPH_JOIN = "\n\n";

export function sectionContent(section: ScriptSection): string {
  return section.paragraphs.map((p) => p.text).join(PARAGRAPH_JOIN);
}

export type FlatSection = { index: number; role: string; content: string };

export function flattenSections(script: ScriptData): FlatSection[] {
  return script.sections.map((s) => ({
    index: s.index,
    role: s.role,
    content: sectionContent(s),
  }));
}

export function allScriptText(script: ScriptData): string {
  return script.sections.map(sectionContent).join(PARAGRAPH_JOIN);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Drift policy: ≤ threshold passes (spec §5.4). Threshold is policy, not model
// judgment, so this is the single place the verdict is decided.
export function passesDrift(score: number): boolean {
  return score <= LINT_THRESHOLDS.DRIFT_PASS_THRESHOLD;
}

export function totalWordCount(script: ScriptData): number {
  return countWords(allScriptText(script));
}

// First 25% of the script body by word count, clamped to a [250, 1500] window
// (spec §5.4). Returns the opening text plus its word count.
export function extractOpening(script: ScriptData): {
  text: string;
  wordCount: number;
} {
  const words = allScriptText(script).split(/\s+/).filter(Boolean);
  const quarter = Math.floor(words.length * LINT_THRESHOLDS.DRIFT_OPENING_PERCENT);
  const cutoff = Math.min(
    LINT_THRESHOLDS.DRIFT_OPENING_MAX_WORDS,
    Math.max(LINT_THRESHOLDS.DRIFT_OPENING_MIN_WORDS, quarter),
  );
  const slice = words.slice(0, Math.min(cutoff, words.length));
  return { text: slice.join(" "), wordCount: slice.length };
}
