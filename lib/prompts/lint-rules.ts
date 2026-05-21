// Adapted from AgriciDaniel/claude-youtube (MIT) — synthesized from
// sub-skills/script.md + sub-skills/seo.md. No dedicated lint subskill exists
// upstream; the rule taxonomy and thresholds are original to this project,
// drawing on the script anti-pattern callouts in script.md ("Hey guys welcome
// back" = measurable drop-off; filler outros; AI tells; pattern interrupts;
// re-hook at 60%) and the keyword-density notes in seo.md ("2-4x keyword
// density ceiling"; "natural keyword integration, not stuffing").

import type { LintRuleId, LintSeverity } from "@/lib/validation/lint";

// Single source of truth for every numeric threshold (spec §5.5). The prompt
// template interpolates these so the model's instructions and the service-side
// validators never drift apart.
export const LINT_THRESHOLDS = {
  WPM: 150, // slow conversational
  PACING_MAX_RUN_WORDS: 150, // ~15s without a cut
  PACING_WALL_OF_TEXT_WORDS: 200, // max paragraph before wall-of-text
  KEYWORD_VOMIT_FIRST_N_WORDS: 100,
  KEYWORD_VOMIT_MAX_OCCURRENCES: 3,
  EM_DASH_MAX_PER_PARAGRAPH: 1,
  HOOK_MAX_WORDS_NO_HOOK_CONTENT: 90,
  HOOK_HARD_MAX_WORDS: 300,
  REHOOK_SECTION_MIN_WORDS: 300,
  REHOOK_TAIL_WINDOW_WORDS: 30,
  LOOP_PAYOFF_TAIL_PERCENT: 0.15,
  DRIFT_OPENING_PERCENT: 0.25,
  DRIFT_OPENING_MIN_WORDS: 250,
  DRIFT_OPENING_MAX_WORDS: 1500,
  DRIFT_PASS_THRESHOLD: 40,
  TONE_REQUIRED_TOP_VIDEOS: 10,
} as const;

export type RuleGroup =
  | "cliche"
  | "ai-tell"
  | "hostage-engagement"
  | "keyword-vomit"
  | "pacing"
  | "drift"
  | "seo"
  | "retention"
  | "hook"
  | "structure"
  | "tone";

export interface RuleSpec {
  id: LintRuleId;
  group: RuleGroup;
  defaultSeverity: LintSeverity;
  scope: "section" | "global";
  coldOpenOnly?: boolean; // section rules that only apply to sectionIndex 0
  description: string; // 1-2 lines, surfaced in the issue message
  positiveExamples: string[]; // MUST match
  negativeExamples: string[]; // MUST NOT match (boundaries)
  suggestionTemplate: string; // how the model phrases suggestedFix
}

// The closed Phase-1 taxonomy. Order groups the prompt output so the service
// can emit one `scanning_rule` progress event per group prefix.
export const RULE_SPECS: RuleSpec[] = [
  {
    id: "cliche/welcome-back",
    group: "cliche",
    defaultSeverity: "warning",
    scope: "section",
    coldOpenOnly: true,
    description: "Channel-first greeting in the cold open — a measurable retention killer.",
    positiveExamples: [
      "Hey guys, welcome back to the channel",
      "What's up everyone, welcome back",
    ],
    negativeExamples: [
      "this is the channel where we welcome you back to crypto",
    ],
    suggestionTemplate: "Replace with the cold-open hook from Stage 6; open cold on the tension.",
  },
  {
    id: "cliche/dont-forget-to-subscribe",
    group: "cliche",
    defaultSeverity: "warning",
    scope: "section",
    description: "Generic subscribe ask that breaks momentum.",
    positiveExamples: [
      "don't forget to subscribe",
      "smash that subscribe button",
    ],
    negativeExamples: ["I subscribe to the theory that"],
    suggestionTemplate: "Cut it, or replace with a value-tied CTA at the ~25% mark.",
  },
  {
    id: "cliche/in-this-video",
    group: "cliche",
    defaultSeverity: "info",
    scope: "section",
    coldOpenOnly: true,
    description: "Meta throat-clearing instead of delivering the promise.",
    positiveExamples: [
      "In this video, we'll cover three things",
      "today we're going to be talking about",
    ],
    negativeExamples: ["in the video I showed last week"],
    suggestionTemplate: "Drop the meta-statement and deliver the first point directly.",
  },
  {
    id: "ai-tell/it-is-important-to-note",
    group: "ai-tell",
    defaultSeverity: "error",
    scope: "section",
    description: "Formal LLM phrasing that kills authenticity.",
    positiveExamples: [
      "It is important to note that the model isn't thinking",
      "it's worth noting that",
    ],
    negativeExamples: ["It's worth your time to read this"],
    suggestionTemplate: "Replace with 'But here's the catch:' or omit entirely.",
  },
  {
    id: "ai-tell/excessive-em-dash",
    group: "ai-tell",
    defaultSeverity: "warning",
    scope: "section",
    description: `More than ${LINT_THRESHOLDS.EM_DASH_MAX_PER_PARAGRAPH} em-dash (—) in a single paragraph.`,
    positiveExamples: [
      "The model — and this is key — predicts — one token at a time.",
    ],
    negativeExamples: ["The model predicts one token at a time."],
    suggestionTemplate: "Rewrite with periods or commas; keep at most one em-dash per paragraph.",
  },
  {
    id: "ai-tell/delve-into",
    group: "ai-tell",
    defaultSeverity: "warning",
    scope: "section",
    description: "The 'delve' family of AI tells.",
    positiveExamples: ["Let's delve into the math", "delving into", "delve deeper"],
    negativeExamples: ["Delve is a band from the 90s"],
    suggestionTemplate: "Replace with 'let's look at' / 'here's how'.",
  },
  {
    id: "ai-tell/in-conclusion",
    group: "ai-tell",
    defaultSeverity: "warning",
    scope: "section",
    description: "Essay-style closer used as a section opener.",
    positiveExamples: [
      "In conclusion, the model is just predicting tokens.",
      "To summarize, ",
      "To wrap up, ",
    ],
    negativeExamples: ["In a conclusion drawn by the authors"],
    suggestionTemplate: "Cut the closer; keep energy to the final second.",
  },
  {
    id: "hostage-engagement/like-and-subscribe-or-else",
    group: "hostage-engagement",
    defaultSeverity: "error",
    scope: "section",
    description: "Engagement framed as a conditional/hostage ask.",
    positiveExamples: [
      "Subscribe before I show you the secret",
      "if you don't subscribe you'll miss",
    ],
    negativeExamples: ["Subscribe to my newsletter for weekly drops"],
    suggestionTemplate: "Replace with a value-aligned CTA ('join the build logs').",
  },
  {
    id: "keyword-vomit/repeated-primary-keyword",
    group: "keyword-vomit",
    defaultSeverity: "warning",
    scope: "section",
    coldOpenOnly: true,
    description: `Primary keyword appears > ${LINT_THRESHOLDS.KEYWORD_VOMIT_MAX_OCCURRENCES}× in the first ${LINT_THRESHOLDS.KEYWORD_VOMIT_FIRST_N_WORDS} words.`,
    positiveExamples: [
      "Claude memory is great. Claude memory works. Claude memory rocks. Claude memory wins.",
    ],
    negativeExamples: ["Claude memory works. The memory feature has limits."],
    suggestionTemplate: "Use synonyms/pronouns after the first 1-2 mentions.",
  },
  {
    id: "pacing/over-15s-without-cut",
    group: "pacing",
    defaultSeverity: "warning",
    scope: "section",
    description: `A run > ${LINT_THRESHOLDS.PACING_MAX_RUN_WORDS} words (~15s) with no B-roll/visual cue.`,
    positiveExamples: ["a 200-word monologue with no bracketed cue"],
    negativeExamples: ["a 200-word monologue with a B-roll cue at word 80"],
    suggestionTemplate: "Insert a B-roll cue and break the monologue into <150-word beats.",
  },
  {
    id: "pacing/wall-of-text",
    group: "pacing",
    defaultSeverity: "info",
    scope: "section",
    description: `A single paragraph > ${LINT_THRESHOLDS.PACING_WALL_OF_TEXT_WORDS} words with no break.`,
    positiveExamples: ["one paragraph of 250 words"],
    negativeExamples: ["two paragraphs of 130 words each"],
    suggestionTemplate: "Split the paragraph at a natural beat.",
  },
  {
    id: "drift/title-promise-not-met-by-2min",
    group: "drift",
    defaultSeverity: "error",
    scope: "global",
    description: "Title subject/outcome not delivered in the first 25% of the script.",
    positiveExamples: [
      "Title 'I tested Claude memory for 30 days' but the opening never mentions memory or 30 days",
    ],
    negativeExamples: ["Title and opening align on subject and outcome"],
    suggestionTemplate: "Re-run Stage 7 with a tighter cold open, or re-pick the title.",
  },
  {
    id: "drift/topic-shift-mid-section",
    group: "drift",
    defaultSeverity: "warning",
    scope: "section",
    description: "A section opens on one topic and closes on an unrelated one.",
    positiveExamples: [
      "Opens 'Let's talk about X' and closes 'Now Y is interesting because…' with no transition",
    ],
    negativeExamples: ["Section stays on a single topic"],
    suggestionTemplate: "Add a transition or split into two sections.",
  },
  {
    id: "seo/keyword-once",
    group: "seo",
    defaultSeverity: "info",
    scope: "global",
    description: "Primary keyword spoken < 1× in the body (outside the cold open).",
    positiveExamples: ["Title 'Claude memory walkthrough' but body never says 'memory'"],
    negativeExamples: ["Body says 'memory' 2×"],
    suggestionTemplate: "Add one natural mention in the cold open and one in the payoff.",
  },
  {
    id: "retention/no-rehook-at-section-break",
    group: "retention",
    defaultSeverity: "info",
    scope: "section",
    description: `A section > ${LINT_THRESHOLDS.REHOOK_SECTION_MIN_WORDS} words ends with no question/cliffhanger/pattern interrupt.`,
    positiveExamples: ["a 400-word section ending mid-explanation"],
    negativeExamples: ["…but here's the part I almost missed."],
    suggestionTemplate: "End the section on a forward hook teasing the next beat.",
  },
  {
    id: "retention/missing-loop-payoff",
    group: "retention",
    defaultSeverity: "warning",
    scope: "global",
    description: "An opened loop (question/mystery/'I'll show you') is never closed in the final 15%.",
    positiveExamples: [
      "Hook 'one will surprise you' but the script never enumerates the third thing",
    ],
    negativeExamples: ["Hook poses a question; the closing section answers it"],
    suggestionTemplate: "Close the loop explicitly in the payoff/loop-close section.",
  },
  {
    id: "hook/over-30s",
    group: "hook",
    defaultSeverity: "warning",
    scope: "section",
    coldOpenOnly: true,
    description: `Cold open exceeds ${LINT_THRESHOLDS.HOOK_MAX_WORDS_NO_HOOK_CONTENT} words with no curiosity/fear/result hook, or exceeds ${LINT_THRESHOLDS.HOOK_HARD_MAX_WORDS} words regardless.`,
    positiveExamples: ["a 350-word cold open meandering through context"],
    negativeExamples: ["a 200-word cold open with a hook in the first 30 words"],
    suggestionTemplate: "Tighten to a single curiosity gap in the first 2 seconds.",
  },
  {
    id: "structure/missing-cold-open-marker",
    group: "structure",
    defaultSeverity: "error",
    scope: "global",
    description: "sections[0].role is not 'cold_open', or the cold open is missing.",
    positiveExamples: ["Section 0 has role 'demonstration'"],
    negativeExamples: ["Section 0 has role 'cold_open'"],
    suggestionTemplate: "Re-run Stage 7 so the script opens with the locked hook.",
  },
  {
    id: "tone/voice-mismatch",
    group: "tone",
    defaultSeverity: "info",
    scope: "global",
    description: `Vocabulary register diverges from the channel's top videos (only when ≥ ${LINT_THRESHOLDS.TONE_REQUIRED_TOP_VIDEOS} titles available).`,
    positiveExamples: [
      "Channel titles are casual but the script reads like a research paper",
    ],
    negativeExamples: ["Vocabulary aligns within ±1 register level"],
    suggestionTemplate: "Match the channel's casual/technical register.",
  },
];

// Defensive lookup the service uses to normalize the model's reported severity
// back to the rule's policy default (the model may not promote/demote).
export const DEFAULT_SEVERITY: Record<LintRuleId, LintSeverity> = Object.freeze(
  RULE_SPECS.reduce(
    (acc, r) => {
      acc[r.id] = r.defaultSeverity;
      return acc;
    },
    {} as Record<LintRuleId, LintSeverity>,
  ),
);

// Rendered once at module load and embedded in the cached system prompt, so the
// system text is byte-stable across runs (CRIT-3 cache hit relies on this).
export function renderRulesForPrompt(): string {
  return RULE_SPECS.map((r) => {
    const scope = r.coldOpenOnly
      ? "section (cold open, sectionIndex 0 only)"
      : r.scope;
    const pos = r.positiveExamples.map((e) => `      MATCH: "${e}"`).join("\n");
    const neg = r.negativeExamples
      .map((e) => `      NO MATCH: "${e}"`)
      .join("\n");
    return `- ${r.id}  [${r.defaultSeverity} · ${scope}]
    ${r.description}
${pos}
${neg}
    suggestedFix style: ${r.suggestionTemplate}`;
  }).join("\n\n");
}

// Distinct group prefixes in declaration order — drives `scanning_rule`
// progress events (spec §5.3 collapses to one event per prefix observed).
export const RULE_GROUP_ORDER: RuleGroup[] = RULE_SPECS.reduce<RuleGroup[]>(
  (acc, r) => (acc.includes(r.group) ? acc : [...acc, r.group]),
  [],
);
