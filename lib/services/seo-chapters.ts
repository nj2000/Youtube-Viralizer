import { CHAPTER_MIN_GAP_SEC, type Chapter } from "@/lib/validation/seo";
import type { ScriptData, ScriptSection } from "@/lib/validation/script";

// DETERMINISTIC chapter derivation — ZERO LLM calls (spec §5.4). Chapters come
// straight from the Stage 7 script's section boundaries. First chapter is always
// 0:00; consecutive chapters are ≥10s apart; 3–10 total. Pure + unit-tested.

const SHORT_FORM_SEC = 300; // < 5 min → cap at 3 chapters
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "with", "vs",
]);

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && STOPWORDS.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

function labelFor(section: ScriptSection, index: number): string {
  const cleaned = section.title.trim().replace(/[.!?,;:]+$/, "").replace(/\s+/g, " ");
  let label = titleCase(cleaned).slice(0, 80);
  if (label.length < 4) label = `Section ${index + 1}`;
  return label;
}

function totalSecOf(script: ScriptData): number {
  if (script.estimatedRuntimeSec > 0) return script.estimatedRuntimeSec;
  const last = script.sections[script.sections.length - 1];
  return last ? last.endSec : 0;
}

// Keep the first chapter, then each subsequent one only if it's ≥10s after the
// last kept chapter (merges too-close boundaries).
function enforceGap(chapters: Chapter[]): Chapter[] {
  if (chapters.length === 0) return chapters;
  const out: Chapter[] = [chapters[0]!];
  for (const c of chapters.slice(1)) {
    if (c.timeSec - out[out.length - 1]!.timeSec >= CHAPTER_MIN_GAP_SEC) out.push(c);
  }
  return out;
}

function fallbackChapters(totalSec: number): Chapter[] {
  const base = totalSec > 0 ? totalSec : 600;
  const pts: Array<[number, string]> = [
    [0, "Intro"],
    [Math.round(base * 0.15), "The Problem"],
    [Math.round(base * 0.4), "The Solution / Build"],
    [Math.round(base * 0.85), "Conclusion"],
  ];
  const chapters = pts.map(([timeSec, label]) => ({ timeSec, label, fallback: true }));
  chapters[0]!.timeSec = 0;
  const gapped = enforceGap(chapters);
  return gapped.length >= 3 ? gapped : chapters; // tiny videos: keep all 4 anyway
}

// Pick first, the section closest to the midpoint, and last (spec short-form rule).
function shortFormThree(chapters: Chapter[], totalSec: number): Chapter[] {
  const first = chapters[0]!;
  const last = chapters[chapters.length - 1]!;
  const mid = totalSec / 2;
  const middle = chapters
    .slice(1, -1)
    .reduce((best, c) =>
      Math.abs(c.timeSec - mid) < Math.abs(best.timeSec - mid) ? c : best,
    );
  return enforceGap([first, middle, last]);
}

// Even-density prune down to `max` chapters, always keeping first + last.
function prune(chapters: Chapter[], max: number): Chapter[] {
  if (chapters.length <= max) return chapters;
  const step = (chapters.length - 1) / (max - 1);
  const idx = new Set<number>();
  for (let i = 0; i < max; i++) idx.add(Math.round(i * step));
  return chapters.filter((_, i) => idx.has(i));
}

export function deriveChapters(script: ScriptData): Chapter[] {
  const totalSec = totalSecOf(script);
  const sections = [...script.sections].sort((a, b) => a.index - b.index);

  let chapters: Chapter[] = sections.map((s, i) => ({
    timeSec: i === 0 ? 0 : Math.max(0, Math.round(s.startSec)),
    label: labelFor(s, i),
    fallback: false,
  }));

  chapters = enforceGap(chapters);

  if (totalSec > 0 && totalSec < SHORT_FORM_SEC && chapters.length > 3) {
    chapters = shortFormThree(chapters, totalSec);
  }
  if (chapters.length > 10) chapters = prune(chapters, 10);
  if (chapters.length < 3) return fallbackChapters(totalSec);

  return chapters;
}

export function chaptersAreFallback(chapters: Chapter[]): boolean {
  return chapters.some((c) => c.fallback);
}
