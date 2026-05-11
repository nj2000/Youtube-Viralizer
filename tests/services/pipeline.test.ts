import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RunFixture = {
  id: string;
  user_id: string;
  channel_id: string;
  idea_text: string;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  competitor_data: unknown;
  score_data: unknown;
  titles_data: unknown;
  hook_data: unknown;
  script_data: unknown;
  lint_data: unknown;
  thumbnails_data: unknown;
  seo_data: unknown;
  ab_plan_data: unknown;
  engagement_drafts_data: unknown;
};

let currentRow: RunFixture;
let updateCalls: Array<{ patch: Record<string, unknown> }>;

function emptyRun(overrides: Partial<RunFixture> = {}): RunFixture {
  return {
    id: "run_1",
    user_id: "user_1",
    channel_id: "ch_1",
    idea_text: "test idea",
    status: "queued",
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
        then(
          resolve: (v: { data: null; error: null }) => unknown,
        ): unknown {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => buildFakeClient(),
}));

import {
  clearStageHandlers,
  registerStageHandler,
  runStage,
} from "@/lib/services/pipeline";
import {
  GateFailedError,
  MissingDependencyError,
  StageNotImplementedError,
} from "@/lib/services/errors";

beforeEach(() => {
  currentRow = emptyRun();
  updateCalls = [];
  clearStageHandlers();
});

afterEach(() => {
  clearStageHandlers();
});

describe("runStage", () => {
  it("throws MissingDependencyError when a dependsOn column is null", async () => {
    registerStageHandler("score", async () => ({ score: 95 }));
    await expect(runStage("run_1", "score", "user_1")).rejects.toBeInstanceOf(
      MissingDependencyError,
    );
  });

  it("throws StageNotImplementedError when no handler is registered", async () => {
    currentRow = emptyRun({ competitor_data: { sample: true } });
    await expect(runStage("run_1", "score", "user_1")).rejects.toBeInstanceOf(
      StageNotImplementedError,
    );
  });

  it("writes the output to exactly one column on success", async () => {
    currentRow = emptyRun({ competitor_data: { sample: true } });
    registerStageHandler("score", async () => ({ score: 95, passed: true }));

    await runStage("run_1", "score", "user_1");

    const outputWrites = updateCalls.filter((c) => "score_data" in c.patch);
    expect(outputWrites).toHaveLength(1);
    expect(outputWrites[0]!.patch.score_data).toEqual({
      score: 95,
      passed: true,
    });
    // Other stage columns are NOT touched in the same write.
    expect(outputWrites[0]!.patch).not.toHaveProperty("titles_data");
    expect(outputWrites[0]!.patch).not.toHaveProperty("competitor_data");
  });

  it("trips the 92-point gate and marks the run as gated_failed", async () => {
    currentRow = emptyRun({ competitor_data: { sample: true } });
    registerStageHandler("score", async () => ({ score: 71, passed: false }));

    await expect(runStage("run_1", "score", "user_1")).rejects.toBeInstanceOf(
      GateFailedError,
    );
    const finalStatus = updateCalls[updateCalls.length - 1]?.patch.status;
    expect(finalStatus).toBe("gated_failed");
  });

  it("does not gate when the score is at the 92 threshold", async () => {
    currentRow = emptyRun({ competitor_data: { sample: true } });
    registerStageHandler("score", async () => ({ score: 92, passed: true }));

    await expect(
      runStage("run_1", "score", "user_1"),
    ).resolves.toBeDefined();
  });
});
