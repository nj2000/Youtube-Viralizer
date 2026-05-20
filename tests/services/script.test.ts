import { describe, expect, it } from "vitest";

import {
  parseParagraphsFromBlock,
  parseScriptWireFormat,
  validateScript,
} from "@/lib/services/script-parse";
import {
  predictRetentionCurve,
  sectionRetention,
} from "@/lib/services/retention-curve";
import { normalizeWhitespace } from "@/lib/validation/script";

const HOOK = "Most AI startups are lying to you about what RAG actually does.";

function block(index: number, title: string, role: string, lines: string[]): string {
  return [`## SECTION ${index} | ${title} | role=${role}`, ...lines].join("\n");
}

function eightMinScript(hook = HOOK): string {
  return [
    block(0, "COLD OPEN", "cold_open", [`[SKELETON] ${hook}`]),
    block(1, "THE PROMISE", "promise", ["[SKELETON] Here is what you will learn."]),
    block(2, "SETUP", "setup", ["[SKELETON] First, the context."]),
    block(3, "DEMONSTRATION", "demonstration", ["[SKELETON] Watch this work."]),
    block(4, "PAYOFF", "payoff", ["[SKELETON] And here is the result."]),
    block(5, "LOOP CLOSE", "loop_close", ["[SKELETON] That is the whole trick."]),
  ].join("\n<section_break/>\n");
}

describe("script-parse — wire format", () => {
  it("parses 6 sections for an 8-min script and stores markers as fields", () => {
    const parsed = parseScriptWireFormat(eightMinScript(), 8);
    expect(parsed.sections).toHaveLength(6);
    const first = parsed.sections[0]!.paragraphs[0]!;
    expect(first.marker).toBe("skeleton");
    expect(first.text).not.toContain("[SKELETON]"); // marker is a field, not inline
  });

  it("parses [PERSONALITY] prompt + text into separate fields", () => {
    const paras = parseParagraphsFromBlock(
      "[PERSONALITY] prompt=React with surprise | This is wild, right?",
    );
    expect(paras[0]).toEqual({
      marker: "personality",
      text: "This is wild, right?",
      personalityPrompt: "React with surprise",
    });
  });
});

describe("script-parse — validation", () => {
  it("passes a well-formed script with the verbatim hook", () => {
    const parsed = parseScriptWireFormat(eightMinScript(), 8);
    const violations = validateScript({
      parsed,
      targetMinutes: 8,
      lockedHook: HOOK,
    });
    expect(violations).toEqual([]);
  });

  it("flags a non-verbatim cold open", () => {
    const parsed = parseScriptWireFormat(eightMinScript("A totally different hook."), 8);
    const violations = validateScript({
      parsed,
      targetMinutes: 8,
      lockedHook: HOOK,
    });
    expect(violations.some((v) => v.includes("verbatim"))).toBe(true);
  });

  it("normalizes whitespace for the verbatim match", () => {
    const spaced = eightMinScript(`Most AI   startups are lying to you about what RAG actually does.`);
    const parsed = parseScriptWireFormat(spaced, 8);
    const violations = validateScript({
      parsed,
      targetMinutes: 8,
      lockedHook: HOOK,
    });
    expect(violations).toEqual([]);
    expect(normalizeWhitespace("a   b")).toBe("a b");
  });

  it("flags the wrong section count", () => {
    const tooFew = [
      block(0, "COLD OPEN", "cold_open", [`[SKELETON] ${HOOK}`]),
      block(1, "PROMISE", "promise", ["[SKELETON] x"]),
    ].join("\n<section_break/>\n");
    const parsed = parseScriptWireFormat(tooFew, 8);
    const violations = validateScript({ parsed, targetMinutes: 8, lockedHook: HOOK });
    expect(violations.some((v) => v.includes("sections"))).toBe(true);
  });
});

describe("retention-curve heuristic", () => {
  const sections = [
    { index: 0, role: "cold_open" as const, title: "C", startSec: 0, endSec: 16, paragraphs: [], brollCues: [], retentionRehook: null, predictedRetention: 0 },
    { index: 1, role: "demonstration" as const, title: "D", startSec: 16, endSec: 400, paragraphs: [], brollCues: [], retentionRehook: null, predictedRetention: 0 },
  ];

  it("samples roughly every 30s and decays after the cold open", () => {
    const curve = predictRetentionCurve({
      sections,
      rehookBeats: [],
      openLoopCount: 0,
      estimatedRuntimeSec: 400,
    });
    expect(curve.length).toBeGreaterThanOrEqual(10);
    expect(curve[0]!.predicted).toBe(100); // first 30s free
    expect(curve.at(-1)!.predicted).toBeLessThan(100); // decayed
    for (const s of curve) {
      expect(s.predicted).toBeGreaterThanOrEqual(0);
      expect(s.predicted).toBeLessThanOrEqual(100);
    }
  });

  it("rehook proximity raises the nearby sample", () => {
    const withRehook = predictRetentionCurve({
      sections,
      rehookBeats: [{ afterSectionIndex: 1, atSec: 120, text: "x" }],
      openLoopCount: 0,
      estimatedRuntimeSec: 400,
    });
    const without = predictRetentionCurve({
      sections,
      rehookBeats: [],
      openLoopCount: 0,
      estimatedRuntimeSec: 400,
    });
    const at120With = withRehook.find((s) => s.timeSec === 120)!.predicted;
    const at120Without = without.find((s) => s.timeSec === 120)!.predicted;
    expect(at120With).toBeGreaterThan(at120Without);
  });

  it("sectionRetention averages in-range samples", () => {
    const curve = predictRetentionCurve({
      sections,
      rehookBeats: [],
      openLoopCount: 0,
      estimatedRuntimeSec: 400,
    });
    const r = sectionRetention(curve, 0, 16);
    expect(r).toBe(100);
  });
});
