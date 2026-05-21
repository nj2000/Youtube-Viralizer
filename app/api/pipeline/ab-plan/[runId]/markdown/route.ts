import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getRunRow } from "@/lib/db/runs";
import { readAbPlanData } from "@/lib/db/ab-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ABPlan } from "@/lib/validation/ab-plan";

export const runtime = "nodejs";

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

function pct(bp: number): string {
  const sign = bp > 0 ? "+" : "";
  return `${sign}${(bp / 100).toFixed(1)}%`;
}

function renderMarkdown(plan: ABPlan): string {
  const lines: string[] = ["# A/B Test Plan", "", `Baseline CTR: ${(plan.baselineCtrBp / 100).toFixed(1)}% (${plan.baselineSource})`, ""];
  plan.variants.forEach((v, i) => {
    const ship = i === plan.shipDefault ? " — **ship-default**" : "";
    lines.push(
      `## Variant ${i + 1} · ${v.trigger}${ship}`,
      `**Title:** ${v.titleText}`,
      `**Hypothesis:** ${v.hypothesis}`,
      `**Predicted CTR delta:** ${pct(v.predictedCtrDelta.minBp)} to ${pct(v.predictedCtrDelta.maxBp)}`,
      `**Success metric:** ${v.successMetric}`,
      `**If this wins:** ${v.ifThisWinsLearning}`,
      "",
    );
  });
  lines.push("## Schedule");
  plan.schedule.forEach((s) => lines.push(`- **${s.hour}h — ${s.label}:** ${s.action}`));
  lines.push("", "## Decision rules");
  plan.decisionRules.forEach((r) => lines.push(`- **${r.kind} (h${r.evaluateAtHour}):** ${r.conditionText} → ${r.actionText}`));
  lines.push("", "## What this test teaches", plan.crossTestLearning, "", `_Sample size: ${plan.sampleSizeNote}_`);
  return lines.join("\n");
}

// GET /api/pipeline/ab-plan/[runId]/markdown — plan as copy-paste markdown.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid run id.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, runId);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }

  const plan = await readAbPlanData({ runId, userId: user.id });
  if (!plan) return errorJson(404, "NOT_FOUND", "No A/B plan for this run.");

  return new Response(renderMarkdown(plan), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
