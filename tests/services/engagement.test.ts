import { describe, expect, it } from "vitest";

import { buildSystem, MIN_CACHEABLE_TOKENS, stageModel } from "@/lib/anthropic";
import {
  ENGAGEMENT_SYSTEM,
  ENGAGEMENT_SYSTEM_EST_TOKENS,
} from "@/lib/prompts/engagement";
import { isClean, scanDrafts, scanForbidden } from "@/lib/services/engagement-lint";
import { assembleKitMarkdown } from "@/lib/services/engagement-bundle";
import {
  ENGAGEMENT_MODEL,
  CommunityPostSchema,
  EngagementDraftsSchema,
} from "@/lib/validation/engagement";
import type { Database } from "@/lib/db/types";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

function pinned() {
  return {
    text: "Around 7:14 I show the exact prompt that made this click — what's the first thing you'd try it on?",
    charCount: 96,
    sentenceCount: 2,
    referencedTimestampSec: 434,
    endsWithQuestion: true,
    lintBadges: ["no_hostage_engagement", "ends_with_specific_question"] as const,
  };
}
function community(variant: "pre_publish" | "post_publish") {
  return {
    text: "Spent a month on this and three things surprised me — one I don't think anyone's discussed. Drops soon: which part do you think broke?",
    charCount: 132,
    sentenceCount: 2,
    hasOpenLoop: true,
    poll: null,
    variant,
    badges: ["no_smash_that_like"] as const,
  };
}
function drafts() {
  return {
    pinnedComment: pinned(),
    communityPostPrePublish: community("pre_publish"),
    communityPostPostPublish: community("post_publish"),
    suggestedReplyTemplates: [
      { keyword: "doesn't work", replyTemplate: "Fair — check the timestamped setup and tell me where it breaks.", trigger: "skeptic" as const },
      { keyword: "what tools", replyTemplate: "Everything's in the description; the key one is the model I lingered on.", trigger: "tooling" as const },
      { keyword: "my use case", replyTemplate: "Tell me your stack and I'll point you to the closest part of the build.", trigger: "use_case" as const },
    ],
    metadata: {
      modelId: ENGAGEMENT_MODEL,
      generatedAt: new Date().toISOString(),
      cacheHitRate: 1,
      inputTokens: 10,
      outputTokens: 10,
      lintRetryCount: 0,
      pollAppropriateForNiche: false,
    },
    schemaVersion: 1 as const,
  };
}

describe("EngagementDraftsSchema", () => {
  it("accepts well-formed drafts", () => {
    expect(EngagementDraftsSchema.safeParse(drafts()).success).toBe(true);
  });
  it("enforces the pre/post variant refines", () => {
    const bad = drafts();
    // pre-publish field carrying a post_publish variant
    (bad.communityPostPrePublish as { variant: string }).variant = "post_publish";
    expect(EngagementDraftsSchema.safeParse(bad).success).toBe(false);
  });
  it("requires 3-5 reply templates", () => {
    const bad = drafts();
    bad.suggestedReplyTemplates = bad.suggestedReplyTemplates.slice(0, 2);
    expect(EngagementDraftsSchema.safeParse(bad).success).toBe(false);
  });
  it("caps community posts at 500 chars", () => {
    expect(CommunityPostSchema.safeParse({ ...community("pre_publish"), text: "x".repeat(501) }).success).toBe(false);
  });
});

describe("engagement lint", () => {
  it("flags forbidden phrases", () => {
    expect(scanForbidden("Please smash that like button!")).toContain("smash that like");
    expect(isClean("A warm, specific question about the build.")).toBe(true);
  });
  it("dedups across drafts", () => {
    expect(scanDrafts(["smash that like", "hey guys", "smash that like"]).sort()).toEqual(["hey guys", "smash that like"]);
  });
});

describe("kit bundle export", () => {
  function run(overrides: Partial<RunRow> = {}): RunRow {
    const filled = {} as Record<string, unknown>;
    for (const c of ["competitor_data", "score_data", "titles_data", "hook_data", "script_data", "lint_data", "thumbnails_data", "seo_data", "ab_plan_data", "engagement_drafts_data"]) {
      filled[c] = { ok: true };
    }
    return { id: "11111111-1111-1111-1111-111111111111", channel_id: "c1", idea_text: "My idea", ...filled, ...overrides } as unknown as RunRow;
  }

  it("renders 12 H2 sections + the MIT footer when complete", () => {
    const { markdown, missingStages } = assembleKitMarkdown(run());
    expect(missingStages).toEqual([]);
    expect((markdown.match(/^## /gm) ?? []).length).toBe(12);
    expect(markdown).toContain("MIT license");
  });
  it("reports missing stages when a data column is null", () => {
    const { missingStages } = assembleKitMarkdown(run({ seo_data: null }));
    expect(missingStages).toContain(10);
  });
});

describe("model routing + cache", () => {
  it("routes engagement to Haiku 4.5 (CRIT-2)", () => {
    expect(stageModel.engagement).toBe("claude-haiku-4-5-20251001");
    expect(stageModel.engagement).toBe(ENGAGEMENT_MODEL);
  });
  it("caches the system prompt (CRIT-3)", () => {
    expect(ENGAGEMENT_SYSTEM_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    const block = buildSystem(ENGAGEMENT_SYSTEM, ENGAGEMENT_SYSTEM_EST_TOKENS)[0]!;
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });
});
