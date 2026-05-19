import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RunFixture = Record<string, unknown>;

let currentRow: RunFixture;
let updateCalls: Array<{ patch: Record<string, unknown> }>;

function emptyRun(overrides: Partial<RunFixture> = {}): RunFixture {
  return {
    id: "run_1",
    user_id: "user_1",
    channel_id: "ch_1",
    idea_text: "test idea long enough",
    status: "queued",
    current_stage: null,
    failure_reason: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    competitor_data: null,
    score_data: null,
    titles_data: null,
    hook_data: null,
    script_data: null,
    lint_data: null,
    thumbnails_data: null,
    seo_data: null,
    ab_plan_data: null,
    engagement_drafts_data: null,
    stale_competitor: false,
    stale_score: false,
    stale_titles: false,
    stale_hook: false,
    stale_script: false,
    stale_lint: false,
    stale_thumbnails: false,
    stale_seo: false,
    stale_ab_plan: false,
    stale_engagement_drafts: false,
    ...overrides,
  };
}

function buildFakeClient() {
  return {
    from() {
      return {
        select() {
          return this;
        },
        update(patch: Record<string, unknown>) {
          updateCalls.push({ patch });
          Object.assign(currentRow, patch);
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        async maybeSingle() {
          return { data: currentRow, error: null };
        },
        async single() {
          return { data: currentRow, error: null };
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => buildFakeClient(),
}));

vi.mock("@/lib/services/pipeline-bus", () => ({
  publish: vi.fn(async () => {}),
}));

import {
  markGateFailed,
  markStageComplete,
  markStageFailed,
} from "@/lib/services/pipeline-state";

beforeEach(() => {
  currentRow = emptyRun({ competitor_data: { sample: true } });
  updateCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("markStageComplete", () => {
  it("writes the stage column, clears own stale, and marks downstream stale for populated columns", async () => {
    currentRow = emptyRun({
      competitor_data: { sample: true },
      score_data: { score: 95, passed: true },
      titles_data: { candidates: [] },
      hook_data: { hook: "x" },
      script_data: { transcript: "x" },
      lint_data: { issues: 0 },
      thumbnails_data: { briefs: [] },
      seo_data: { tags: [] },
      ab_plan_data: { plan: "x" },
      engagement_drafts_data: { drafts: [] },
      stale_titles: true,
    });

    await markStageComplete("run_1", "titles", { regenerated: true });

    const patch = updateCalls[updateCalls.length - 1]!.patch;
    expect(patch.titles_data).toEqual({ regenerated: true });
    expect(patch.stale_titles).toBe(false);
    // Verification matrix: re-running stage 5 flips 6/7/8/10/12 stale on a
    // run where each downstream column is already populated.
    expect(patch.stale_hook).toBe(true);
    expect(patch.stale_script).toBe(true);
    expect(patch.stale_lint).toBe(true);
    expect(patch.stale_seo).toBe(true);
    expect(patch.stale_engagement_drafts).toBe(true);
    // Upstream stays unflipped.
    expect(patch.stale_competitor).toBeUndefined();
    expect(patch.stale_score).toBeUndefined();
  });

  it("does NOT mark downstream stale for columns that are still null", async () => {
    // Fresh run — only competitor data populated. Re-running titles writes
    // titles_data and clears its own stale, but doesn't flip 6-12 because
    // they're not 'stale' — they're 'not yet computed'.
    currentRow = emptyRun({
      competitor_data: { sample: true },
      score_data: { score: 95 },
    });

    await markStageComplete("run_1", "titles", { candidates: [] });

    const patch = updateCalls[updateCalls.length - 1]!.patch;
    expect(patch.titles_data).toBeDefined();
    expect(patch.stale_titles).toBe(false);
    expect(patch.stale_hook).toBeUndefined();
    expect(patch.stale_script).toBeUndefined();
    expect(patch.stale_lint).toBeUndefined();
  });
});

describe("markGateFailed", () => {
  it("sets failure_reason to the exact verification string", async () => {
    await markGateFailed("run_1", 71);
    const patch = updateCalls[updateCalls.length - 1]!.patch;
    expect(patch.failure_reason).toBe("Score 71 / 100 — below 92 threshold");
    expect(patch.status).toBe("gated_failed");
    expect(patch.current_stage).toBe(4);
  });
});

describe("markStageFailed", () => {
  it("prefixes failure_reason with stage_<n>: and sanitizes raw error bodies", async () => {
    const rawAnthropicBody = `Internal Server Error\n\n{"type":"error","error":{"type":"api_error","message":"<huge stack trace> ... <stuff>"}}`;
    await markStageFailed("run_1", "script", new Error(rawAnthropicBody));
    const patch = updateCalls[updateCalls.length - 1]!.patch;
    expect(typeof patch.failure_reason).toBe("string");
    expect(patch.failure_reason as string).toMatch(/^stage_7:/);
    // No newlines from the raw body leaked through.
    expect((patch.failure_reason as string).includes("\n")).toBe(false);
    // The truncation cap is 200 chars + the "stage_7: " prefix.
    expect((patch.failure_reason as string).length).toBeLessThanOrEqual(220);
    expect(patch.status).toBe("error");
    expect(patch.current_stage).toBe(7);
  });
});
