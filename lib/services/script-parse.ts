import {
  SCRIPT_SECTION_TEMPLATES,
  SCRIPT_WPM,
  normalizeWhitespace,
  type OpenLoop,
  type RehookBeat,
  type ScriptParagraph,
  type ScriptSection,
  type ScriptTargetMinutes,
  type SectionRole,
} from "@/lib/validation/script";

// Parses the Stage 7 wire format (see lib/prompts/script.ts) into structured
// sections, then validates against the deterministic template + the verbatim
// cold-open rule. Pure + unit-tested — no Anthropic or DB access here.

export const SECTION_BREAK = "<section_break/>";

export type ParsedScript = {
  sections: ScriptSection[];
  openLoops: OpenLoop[];
  rehookBeats: RehookBeat[];
  totalWordCount: number;
  estimatedRuntimeSec: number;
};

const HEADER_RE = /^##\s*SECTION\s+(\d+)\s*\|\s*(.+?)\s*\|\s*role=([a-z_]+)\s*$/i;

function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

type Accum = {
  paragraphs: ScriptParagraph[];
  brollCues: { atSec: number; cue: string }[];
  rehook: string | null;
  loopOpens: { id: string; description: string; anchor: string }[];
  loopCloses: string[];
};

function parseBeatLine(line: string, acc: Accum): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let m: RegExpMatchArray | null;
  if ((m = trimmed.match(/^\[SKELETON\]\s*(.+)$/i))) {
    acc.paragraphs.push({ marker: "skeleton", text: m[1]!.trim(), personalityPrompt: null });
  } else if ((m = trimmed.match(/^\[PERSONALITY\]\s*prompt=(.+?)\s*\|\s*(.+)$/i))) {
    acc.paragraphs.push({
      marker: "personality",
      text: m[2]!.trim(),
      personalityPrompt: m[1]!.trim().slice(0, 280),
    });
  } else if ((m = trimmed.match(/^\[PERSONALITY\]\s*(.+)$/i))) {
    acc.paragraphs.push({
      marker: "personality",
      text: m[1]!.trim(),
      personalityPrompt: "Inject your own voice here.",
    });
  } else if ((m = trimmed.match(/^\(broll\)\s*(.+)$/i))) {
    acc.brollCues.push({ atSec: 0, cue: m[1]!.trim().slice(0, 300) });
  } else if ((m = trimmed.match(/^\(rehook\)\s*(.+)$/i))) {
    acc.rehook = m[1]!.trim().slice(0, 280);
  } else if ((m = trimmed.match(/^\(loop-open\s+(loop-[1-9][0-9]?)\)\s*(.+?)\s*::\s*(.+)$/i))) {
    acc.loopOpens.push({
      id: m[1]!,
      description: m[2]!.trim().slice(0, 120),
      anchor: m[3]!.trim().slice(0, 160),
    });
  } else if ((m = trimmed.match(/^\(loop-close\s+(loop-[1-9][0-9]?)\)\s*$/i))) {
    acc.loopCloses.push(m[1]!);
  } else if (trimmed.startsWith("##")) {
    // header handled by caller
  } else {
    acc.paragraphs.push({ marker: null, text: trimmed, personalityPrompt: null });
  }
}

// Parse just the beat lines of one section block into paragraphs (used by
// single-section regeneration, which keeps the section's role/title/bounds).
export function parseParagraphsFromBlock(block: string): ScriptParagraph[] {
  const acc: Accum = {
    paragraphs: [],
    brollCues: [],
    rehook: null,
    loopOpens: [],
    loopCloses: [],
  };
  for (const line of block.split("\n")) {
    if (line.trim().startsWith("##")) continue;
    parseBeatLine(line, acc);
  }
  return acc.paragraphs.slice(0, 10);
}

export function parseScriptWireFormat(
  raw: string,
  targetMinutes: ScriptTargetMinutes,
): ParsedScript {
  const template = SCRIPT_SECTION_TEMPLATES[targetMinutes];
  const blocks = raw
    .split(SECTION_BREAK)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const sections: ScriptSection[] = [];
  const openLoops: OpenLoop[] = [];
  const rehookBeats: RehookBeat[] = [];
  const closeByLoop = new Map<string, number>();

  let cursorSec = 0;
  let totalWords = 0;

  blocks.forEach((block, blockIndex) => {
    const lines = block.split("\n");
    const headerLine = lines.find((l) => l.trim().startsWith("##")) ?? "";
    const headerMatch = headerLine.match(HEADER_RE);

    const tmpl = template[blockIndex];
    const role: SectionRole =
      (headerMatch?.[3]?.toLowerCase() as SectionRole) ?? tmpl?.role ?? "demonstration";
    const title = (headerMatch?.[2] ?? tmpl?.title ?? `SECTION ${blockIndex}`)
      .toUpperCase()
      .slice(0, 60);

    const acc: Accum = {
      paragraphs: [],
      brollCues: [],
      rehook: null,
      loopOpens: [],
      loopCloses: [],
    };
    for (const line of lines) {
      if (line.trim().startsWith("##")) continue;
      parseBeatLine(line, acc);
    }
    if (acc.paragraphs.length === 0) {
      acc.paragraphs.push({ marker: null, text: "(empty)", personalityPrompt: null });
    }

    const sectionWords = acc.paragraphs.reduce((s, p) => s + wordsIn(p.text), 0);
    const sectionSec = Math.max(1, Math.round((sectionWords / SCRIPT_WPM) * 60));
    const startSec = cursorSec;
    const endSec = cursorSec + sectionSec;
    cursorSec = endSec;
    totalWords += sectionWords;

    sections.push({
      index: blockIndex,
      role,
      title,
      startSec,
      endSec,
      paragraphs: acc.paragraphs.slice(0, 10),
      brollCues: acc.brollCues.map((b) => ({ ...b, atSec: startSec })).slice(0, 6),
      retentionRehook: acc.rehook,
      predictedRetention: 0, // filled by the retention-curve pass
    });

    if (acc.rehook && blockIndex > 0) {
      rehookBeats.push({ afterSectionIndex: blockIndex, atSec: startSec, text: acc.rehook });
    }
    for (const lo of acc.loopOpens) {
      openLoops.push({
        id: lo.id,
        setupSectionIndex: blockIndex,
        payoffSectionIndex: blockIndex, // patched once we see the close
        description: lo.description,
        anchorSubstring: lo.anchor,
      });
    }
    for (const lc of acc.loopCloses) closeByLoop.set(lc, blockIndex);
  });

  // Patch loop payoff indices from the close markers.
  for (const loop of openLoops) {
    const closeAt = closeByLoop.get(loop.id);
    if (closeAt !== undefined && closeAt > loop.setupSectionIndex) {
      loop.payoffSectionIndex = closeAt;
    }
  }

  return {
    sections,
    openLoops,
    rehookBeats,
    totalWordCount: totalWords,
    estimatedRuntimeSec: cursorSec,
  };
}

// Format validation (spec §5.5). Returns the list of violations; empty = valid.
export function validateScript(args: {
  parsed: ParsedScript;
  targetMinutes: ScriptTargetMinutes;
  lockedHook: string;
}): string[] {
  const violations: string[] = [];
  const template = SCRIPT_SECTION_TEMPLATES[args.targetMinutes];

  if (args.parsed.sections.length !== template.length) {
    violations.push(
      `Expected ${template.length} sections, got ${args.parsed.sections.length}.`,
    );
  }

  args.parsed.sections.forEach((section, i) => {
    const tmpl = template[i];
    if (tmpl && section.role !== tmpl.role) {
      violations.push(`Section ${i} role is "${section.role}", expected "${tmpl.role}".`);
    }
    if (section.paragraphs[0]?.marker == null && i === 0) {
      violations.push("Section 0 must open with a [SKELETON] line.");
    }
  });

  // Verbatim cold-open: section 0, paragraph 0, whitespace-normalized.
  const firstText = args.parsed.sections[0]?.paragraphs[0]?.text ?? "";
  if (normalizeWhitespace(firstText) !== normalizeWhitespace(args.lockedHook)) {
    violations.push("Section 0 first paragraph is not the locked hook verbatim.");
  }

  // Loop anchors must appear in their payoff section.
  for (const loop of args.parsed.openLoops) {
    if (loop.payoffSectionIndex <= loop.setupSectionIndex) {
      violations.push(`Loop ${loop.id} has no payoff at least one section later.`);
      continue;
    }
    const payoff = args.parsed.sections[loop.payoffSectionIndex];
    const haystack = payoff
      ? payoff.paragraphs.map((p) => p.text).join(" ").toLowerCase()
      : "";
    if (!haystack.includes(loop.anchorSubstring.toLowerCase())) {
      violations.push(`Loop ${loop.id} anchor not found in payoff section ${loop.payoffSectionIndex}.`);
    }
  }

  return violations;
}
