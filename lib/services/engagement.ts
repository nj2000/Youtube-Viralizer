import "server-only";

import {
  callClaude,
  extractTextFromMessage,
  buildSystem,
} from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { readEngagementData, writeEngagementData } from "@/lib/db/engagement";
import {
  buildEngagementUserPrompt,
  ENGAGEMENT_SYSTEM,
  ENGAGEMENT_SYSTEM_EST_TOKENS,
  type EngagementPromptInput,
} from "@/lib/prompts/engagement";
import {
  ENGAGEMENT_MODEL,
  EngagementDraftsSchema,
  type CommunityPost,
  type EngagementDrafts,
  type EngagementDraftType,
  type PinnedComment,
  type SuggestedReplyTemplate,
} from "@/lib/validation/engagement";
import { ScriptDataSchema, type ScriptData } from "@/lib/validation/script";
import { TRIGGER_ORDER, TitlesDataSchema } from "@/lib/validation/titles";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import { markRunComplete, markStageComplete } from "@/lib/services/pipeline-state";
import { MissingDependencyError } from "./errors";
import { scanDrafts } from "./engagement-lint";

export class MissingEngagementPrereqError extends Error {
  constructor(reason: string) {
    super(`engagement prerequisites not met: ${reason}`);
    this.name = "MissingEngagementPrereqError";
  }
}
export class EngagementLintError extends Error {
  constructor() {
    super("engagement copy failed the forbidden-phrase lint after 3 attempts");
    this.name = "EngagementLintError";
  }
}

export function engagementErrorCode(err: unknown): string {
  if (err instanceof MissingEngagementPrereqError || err instanceof MissingDependencyError) {
    return "MISSING_PREREQUISITES";
  }
  if (err instanceof EngagementLintError) return "LINT_RETRIES_EXHAUSTED";
  return "UPSTREAM_ERROR";
}

type Ctx = { title: string; idea: string; niche: string; scriptCta: string; firstTimestampSec: number | null };

function scriptCtaOf(script: ScriptData): string {
  const close = script.sections.find((s) => s.role === "loop_close") ?? script.sections[script.sections.length - 1];
  return close ? close.paragraphs.map((p) => p.text).join(" ").slice(0, 300) : "";
}

function firstTimestampOf(script: ScriptData): number | null {
  if (script.rehookBeats[0]) return script.rehookBeats[0].atSec;
  const demo = script.sections.find((s) => s.role === "demonstration");
  return demo ? demo.startSec : null;
}

async function buildContext(ctx: StageContext): Promise<Ctx> {
  const titles = TitlesDataSchema.safeParse(ctx.run.titles_data);
  if (!titles.success) throw new MissingEngagementPrereqError("titles_data missing");
  const locked = TRIGGER_ORDER.map((t) => titles.data[t]).find((v) => v && v.lockedIn);
  const title = locked?.text ?? TRIGGER_ORDER.map((t) => titles.data[t]).find(Boolean)?.text;
  if (!title) throw new MissingEngagementPrereqError("no title");
  const script = ScriptDataSchema.safeParse(ctx.run.script_data);
  if (!script.success) throw new MissingEngagementPrereqError("script_data missing");

  const supabase = createSupabaseServiceClient();
  const { data } = await supabase.from("channels").select("niche").eq("id", ctx.run.channel_id).is("deleted_at", null).maybeSingle();
  return {
    title,
    idea: ctx.run.idea_text,
    niche: data?.niche ?? "",
    scriptCta: scriptCtaOf(script.data),
    firstTimestampSec: firstTimestampOf(script.data),
  };
}

function parse(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sentenceCount(text: string, max: number): number {
  return Math.max(1, Math.min(max, (text.match(/[.!?]+/g) ?? []).length || 1));
}

function clampStr(value: unknown, min: number, max: number, fallback: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length >= min ? s.slice(0, max) : fallback;
}

function coercePinned(raw: Record<string, unknown> | undefined, ctx: Ctx): PinnedComment {
  const pc = (raw ?? {}) as Record<string, unknown>;
  const text = clampStr(pc.text, 20, 800, `Around the midpoint I show the exact step that made this work — what's the one part of this you'd try first on your own project?`);
  const ts = Number.isFinite(Number(pc.referencedTimestampSec)) ? Math.max(0, Math.trunc(Number(pc.referencedTimestampSec))) : ctx.firstTimestampSec;
  const endsWithQuestion = text.trim().endsWith("?");
  const clean = scanDrafts([text]).length === 0;
  const badges: PinnedComment["lintBadges"] = [];
  if (clean) badges.push("no_hostage_engagement");
  if (ts !== null) badges.push("references_specific_timestamp");
  if (endsWithQuestion) badges.push("ends_with_specific_question");
  if (!ctx.scriptCta || !text.includes(ctx.scriptCta.slice(0, 30))) badges.push("distinct_from_script_cta");
  return {
    text,
    charCount: text.length,
    sentenceCount: sentenceCount(text, 4),
    referencedTimestampSec: ts,
    endsWithQuestion,
    lintBadges: badges,
  };
}

function coercePoll(raw: unknown): CommunityPost["poll"] {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const question = clampStr(p.question, 5, 120, "");
  const options = Array.isArray(p.options)
    ? p.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim().slice(0, 60)).slice(0, 4)
    : [];
  if (question.length < 5 || options.length < 2) return null;
  return { question, options };
}

function coerceCommunity(raw: Record<string, unknown> | undefined, variant: "pre_publish" | "post_publish", fallback: string): CommunityPost {
  const cp = (raw ?? {}) as Record<string, unknown>;
  const text = clampStr(cp.text, 40, 500, fallback);
  const clean = scanDrafts([text]).length === 0;
  const badges: CommunityPost["badges"] = [];
  if (variant === "pre_publish") badges.push("open_loop_no_spoiler");
  else badges.push("callbacks_pre_publish", "distinct_from_pinned");
  if (clean) badges.push("no_smash_that_like");
  return {
    text,
    charCount: text.length,
    sentenceCount: sentenceCount(text, 8),
    hasOpenLoop: /\?|guess|which|what|drops|coming/i.test(text),
    poll: variant === "pre_publish" ? coercePoll(cp.poll) : null,
    variant,
    badges,
  };
}

const REPLY_TRIGGERS = ["skeptic", "use_case", "tooling", "follow_up", "appreciation"] as const;
const DEFAULT_REPLIES: SuggestedReplyTemplate[] = [
  { keyword: "doesn't work", replyTemplate: "Totally fair to be skeptical — at the timestamp I show the exact setup, so check that and tell me where it breaks for you.", trigger: "skeptic" },
  { keyword: "what tools", replyTemplate: "I list every tool and model in the description; the one that mattered most is the one I lingered on mid-video.", trigger: "tooling" },
  { keyword: "for my use case", replyTemplate: "Great question — it adapts well if your workflow looks similar; tell me your use case and I'll point you to the closest part.", trigger: "use_case" },
];

function coerceReplies(raw: unknown): SuggestedReplyTemplate[] {
  const out: SuggestedReplyTemplate[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const keyword = clampStr(rr.keyword, 2, 60, "");
      const replyTemplate = clampStr(rr.replyTemplate, 20, 400, "");
      const trigger = REPLY_TRIGGERS.includes(rr.trigger as never) ? (rr.trigger as SuggestedReplyTemplate["trigger"]) : "follow_up";
      if (keyword && replyTemplate) out.push({ keyword, replyTemplate, trigger });
    }
  }
  while (out.length < 3) out.push(DEFAULT_REPLIES[out.length] ?? DEFAULT_REPLIES[0]!);
  return out.slice(0, 5);
}

function assemble(raw: Record<string, unknown> | null, ctx: Ctx, lintRetryCount: number, usage: { input: number; output: number; cacheHit: boolean }): EngagementDrafts {
  const pinned = coercePinned(raw?.pinnedComment as Record<string, unknown>, ctx);
  const pre = coerceCommunity(raw?.communityPostPrePublish as Record<string, unknown>, "pre_publish", `Spent weeks on this and three things genuinely surprised me — one I don't think anyone's talking about yet. New video drops soon: which part do you think went wrong?`);
  const post = coerceCommunity(raw?.communityPostPostPublish as Record<string, unknown>, "post_publish", `It's live. The part that broke wasn't what most of you guessed — the bit mid-video alone will save you a weekend if you're building anything similar.`);
  return EngagementDraftsSchema.parse({
    pinnedComment: pinned,
    communityPostPrePublish: pre,
    communityPostPostPublish: post,
    suggestedReplyTemplates: coerceReplies(raw?.suggestedReplyTemplates),
    metadata: {
      modelId: ENGAGEMENT_MODEL,
      generatedAt: new Date().toISOString(),
      cacheHitRate: usage.cacheHit ? 1 : 0,
      inputTokens: usage.input,
      outputTokens: usage.output,
      lintRetryCount,
      pollAppropriateForNiche: pre.poll !== null,
    },
    schemaVersion: 1,
  });
}

async function generate(ctx: Ctx): Promise<EngagementDrafts> {
  const system = buildSystem(ENGAGEMENT_SYSTEM, ENGAGEMENT_SYSTEM_EST_TOKENS);
  let hits: string[] = [];
  let attempt = 0;
  let drafts: EngagementDrafts | null = null;
  while (attempt < 3) {
    const input: EngagementPromptInput = { ...ctx, forbiddenHits: hits };
    const msg = await callClaude({ stage: "engagement", system, messages: [{ role: "user", content: buildEngagementUserPrompt(input) }], maxTokens: 1400 });
    const usage = { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cacheHit: (msg.usage.cache_read_input_tokens ?? 0) > 0 };
    drafts = assemble(parse(extractTextFromMessage(msg)), ctx, attempt, usage);
    attempt++;
    hits = scanDrafts([
      drafts.pinnedComment.text,
      drafts.communityPostPrePublish.text,
      drafts.communityPostPostPublish.text,
      ...drafts.suggestedReplyTemplates.map((r) => r.replyTemplate),
    ]);
    if (hits.length === 0) return drafts;
  }
  throw new EngagementLintError();
}

export async function engagementStageHandler(ctx: StageContext): Promise<Json> {
  await publish(ctx.runId, { event: "progress", payload: { stage: 12, message: "Drafting engagement copy…" } });
  return (await generate(await buildContext(ctx))) as unknown as Json;
}

// Manual run / final ship: runs the handler, persists, AND completes the run
// (Stage 12 is the only stage that sets status='complete').
export async function runEngagementManual(run: StageContext["run"], userId: string): Promise<void> {
  const output = await generate(await buildContext({ runId: run.id, userId, run }));
  await markStageComplete(run.id, "engagement", output as unknown as Json);
  await markRunComplete(run.id);
}

export async function regenerateEngagementDraft(args: {
  runId: string;
  userId: string;
  run: Database["public"]["Tables"]["pipeline_runs"]["Row"];
  draftType: EngagementDraftType;
}): Promise<EngagementDrafts> {
  const existing = await readEngagementData({ runId: args.runId, userId: args.userId });
  if (!existing) throw new MissingEngagementPrereqError("no engagement drafts to regenerate");
  const fresh = await generate(await buildContext({ runId: args.runId, userId: args.userId, run: args.run }));

  const next: EngagementDrafts = { ...existing };
  if (args.draftType === "pinned") next.pinnedComment = fresh.pinnedComment;
  else if (args.draftType === "pre") next.communityPostPrePublish = fresh.communityPostPrePublish;
  else if (args.draftType === "post") next.communityPostPostPublish = fresh.communityPostPostPublish;
  else next.suggestedReplyTemplates = fresh.suggestedReplyTemplates;
  next.metadata = { ...existing.metadata, generatedAt: new Date().toISOString() };

  const validated = EngagementDraftsSchema.parse(next);
  await writeEngagementData({ runId: args.runId, userId: args.userId }, validated);
  return validated;
}

registerStageHandler("engagement", engagementStageHandler);
