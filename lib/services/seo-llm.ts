import "server-only";

import {
  callClaude,
  extractTextFromMessage,
  type CallClaudeInput,
} from "@/lib/anthropic";
import { buildSystem } from "@/lib/anthropic";
import {
  buildDescriptionUserPrompt,
  buildEndScreenUserPrompt,
  buildHashtagsUserPrompt,
  buildPinnedUserPrompt,
  buildTagsUserPrompt,
  SEO_DESCRIPTION_EST_TOKENS,
  SEO_DESCRIPTION_SYSTEM,
  SEO_ENDSCREEN_EST_TOKENS,
  SEO_ENDSCREEN_SYSTEM,
  SEO_HASHTAGS_EST_TOKENS,
  SEO_HASHTAGS_SYSTEM,
  SEO_PINNED_EST_TOKENS,
  SEO_PINNED_SYSTEM,
  SEO_TAGS_EST_TOKENS,
  SEO_TAGS_SYSTEM,
  type EndScreenCandidate,
} from "@/lib/prompts/seo";
import {
  DESCRIPTION_MAX_CHARS,
  TAGS_JOINED_MAX_CHARS,
  type Description,
  type EndScreenSuggestions,
  type Hashtags,
  type PinnedCommentDraft,
} from "@/lib/validation/seo";
import { applyDisclosures } from "./seo-compliance";

export class InvalidSeoError extends Error {
  constructor(readonly section: string) {
    super(`seo model returned unusable ${section}`);
    this.name = "InvalidSeoError";
  }
}

export type SeoUsage = {
  input: number;
  output: number;
  cached: number;
  cacheHit: boolean;
};

type Base = { title: string; idea: string; niche: string };

function usageOf(msg: Awaited<ReturnType<typeof callClaude>>): SeoUsage {
  const u = msg.usage;
  const cached = u.cache_read_input_tokens ?? 0;
  return { input: u.input_tokens, output: u.output_tokens, cached, cacheHit: cached > 0 };
}

function parse(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function call(
  system: CallClaudeInput["system"],
  user: string,
  maxTokens: number,
): Promise<{ raw: Record<string, unknown> | null; usage: SeoUsage }> {
  const msg = await callClaude({ stage: "seo", system, messages: [{ role: "user", content: user }], maxTokens });
  return { raw: parse(extractTextFromMessage(msg)), usage: usageOf(msg) };
}

// ── Description ───────────────────────────────────────────────────────────────

function truncateAtSentence(body: string, max: number): string {
  if (body.length <= max) return body;
  const slice = body.slice(0, max);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return (lastStop > max * 0.5 ? slice.slice(0, lastStop + 1) : slice).trim();
}

function aboveFoldOf(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  let af = lines.slice(0, 2).join(" ").trim();
  if (af.length < 40) af = body.replace(/\s+/g, " ").trim().slice(0, 300);
  return af.slice(0, 300);
}

export async function generateDescription(
  base: Base,
  opts: { isSponsored: boolean },
): Promise<{ description: Description; flags: { sponsoredDisclosure: boolean; complianceDisclaimer: boolean }; usage: SeoUsage }> {
  const system = buildSystem(SEO_DESCRIPTION_SYSTEM, SEO_DESCRIPTION_EST_TOKENS);
  let { raw, usage } = await call(system, buildDescriptionUserPrompt(base), 2048);
  let body = typeof raw?.body === "string" ? raw.body.trim() : "";

  if (body.length > DESCRIPTION_MAX_CHARS) {
    ({ raw, usage } = await call(system, buildDescriptionUserPrompt(base, true), 2048));
    const retry = typeof raw?.body === "string" ? raw.body.trim() : body;
    body = retry;
  }

  const disclosed = applyDisclosures(body, { isSponsored: opts.isSponsored, niche: base.niche });
  let truncated = false;
  body = disclosed.body;
  if (body.length > DESCRIPTION_MAX_CHARS) {
    body = truncateAtSentence(body, DESCRIPTION_MAX_CHARS);
    truncated = true;
  }
  if (body.length < 80) throw new InvalidSeoError("description");

  return {
    description: {
      body,
      aboveFold: aboveFoldOf(body),
      wordCount: body.split(/\s+/).filter(Boolean).length,
      truncated,
    },
    flags: { sponsoredDisclosure: disclosed.sponsoredDisclosure, complianceDisclaimer: disclosed.complianceDisclaimer },
    usage,
  };
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function coerceTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (tag.length < 2 || tag.length > 30 || !/^[a-z0-9 .'-]+$/.test(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out.slice(0, 15);
}

// Drop lowest-priority (last) tags until the joined string fits, keeping ≥8.
function trimTagsToFit(tags: string[]): { tags: string[]; trimmed: string[] } {
  const kept = [...tags];
  const trimmed: string[] = [];
  while (kept.join(",").length > TAGS_JOINED_MAX_CHARS && kept.length > 8) {
    trimmed.push(kept.pop()!);
  }
  return { tags: kept, trimmed };
}

export async function generateTags(
  base: Base,
  opts: { avoid?: string[] } = {},
): Promise<{ tags: string[]; trimmed: boolean; trimmedList: string[]; usage: SeoUsage }> {
  const system = buildSystem(SEO_TAGS_SYSTEM, SEO_TAGS_EST_TOKENS);
  const { raw, usage } = await call(system, buildTagsUserPrompt(base, opts), 512);
  const coerced = coerceTags(raw?.tags);
  if (coerced.length < 8) throw new InvalidSeoError("tags");
  const { tags, trimmed } = trimTagsToFit(coerced);
  return { tags, trimmed: trimmed.length > 0, trimmedList: trimmed.slice(0, 5), usage };
}

// ── Hashtags ──────────────────────────────────────────────────────────────────

function coerceHashtags(raw: Record<string, unknown> | null): Hashtags | null {
  const norm = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const h of arr) {
      if (typeof h !== "string") continue;
      let tag = h.trim().toLowerCase().replace(/\s+/g, "");
      if (!tag.startsWith("#")) tag = `#${tag}`;
      if (!/^#[a-z0-9]{1,29}$/.test(tag) || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
    return out;
  };
  const all = [...norm(raw?.primary), ...norm(raw?.optional)];
  const unique = [...new Set(all)];
  if (unique.length < 8) return null;
  return { primary: unique.slice(0, 3), optional: unique.slice(3, 8) };
}

export async function generateHashtags(base: Base): Promise<{ hashtags: Hashtags; usage: SeoUsage }> {
  const system = buildSystem(SEO_HASHTAGS_SYSTEM, SEO_HASHTAGS_EST_TOKENS);
  let { raw, usage } = await call(system, buildHashtagsUserPrompt(base), 300);
  let hashtags = coerceHashtags(raw);
  if (!hashtags) {
    ({ raw, usage } = await call(system, buildHashtagsUserPrompt(base), 300));
    hashtags = coerceHashtags(raw);
    if (!hashtags) throw new InvalidSeoError("hashtags");
  }
  return { hashtags, usage };
}

// ── End screen (candidates picked in TS; model writes reasons) ───────────────

export async function generateEndScreen(
  currentTitle: string,
  candidates: Array<EndScreenCandidate & { affinityType: "most_watched" | "high_affinity" }>,
): Promise<{ endScreen: EndScreenSuggestions; subscribeOnly: boolean; usage: SeoUsage }> {
  const system = buildSystem(SEO_ENDSCREEN_SYSTEM, SEO_ENDSCREEN_EST_TOKENS);
  const { raw, usage } = await call(system, buildEndScreenUserPrompt(currentTitle, candidates), 600);

  const reasons = new Map<string, string>();
  if (Array.isArray(raw?.reasons)) {
    for (const r of raw.reasons as unknown[]) {
      if (r && typeof r === "object") {
        const id = (r as Record<string, unknown>).videoId;
        const reason = (r as Record<string, unknown>).reason;
        if (typeof id === "string" && typeof reason === "string") {
          reasons.set(id, reason.trim().slice(0, 280));
        }
      }
    }
  }
  const videos = candidates
    .map((c) => ({
      videoId: c.videoId,
      title: c.title.slice(0, 500),
      reason: (reasons.get(c.videoId) ?? `Topic continuity with "${currentTitle}" — viewers who finished this will want this next.`).padEnd(60).slice(0, 280),
      affinityType: c.affinityType,
    }))
    .slice(0, 2);

  const ctaRaw = typeof raw?.subscribeCta === "string" ? raw.subscribeCta.trim() : "";
  const cta = (ctaRaw.length >= 40 ? ctaRaw : "If this helped, subscribe — I publish a new deep-dive build every week and you won't want to miss the next one.").slice(0, 280);

  return {
    endScreen: {
      videos,
      subscribePrompt: { placement: videos.length ? "split" : "full_frame", cta },
    },
    subscribeOnly: videos.length === 0,
    usage,
  };
}

// ── Pinned comment ────────────────────────────────────────────────────────────

export async function generatePinned(base: Base): Promise<{ pinned: PinnedCommentDraft; usage: SeoUsage }> {
  const system = buildSystem(SEO_PINNED_SYSTEM, SEO_PINNED_EST_TOKENS);
  const { raw, usage } = await call(system, buildPinnedUserPrompt(base), 512);
  let body = typeof raw?.body === "string" ? raw.body.trim() : "";
  if (body.length > 700) body = body.slice(0, 700);
  if (body.length < 80) throw new InvalidSeoError("pinnedComment");
  return { pinned: { body, template: "tiered_cta" }, usage };
}
