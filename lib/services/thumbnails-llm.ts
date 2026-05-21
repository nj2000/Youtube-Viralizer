import "server-only";

import {
  callClaude,
  extractTextFromMessage,
  type CallClaudeInput,
} from "@/lib/anthropic";
import {
  buildThumbnailUserPrompt,
  type ThumbnailPromptInput,
} from "@/lib/prompts/thumbnails";
import {
  CharacterPlacementSchema,
  FocalPointSchema,
  PaletteRoleSchema,
  StyleRegisterSchema,
  ThumbnailBriefSchema,
  type PaletteSwatch,
  type ThumbnailBrief,
} from "@/lib/validation/thumbnails";
import { enforceOverlayContrast, wordCountOf } from "./thumbnails-palette";

// One Haiku call per trigger, sharing the prebuilt cached system block so calls
// 2/3 hit the ephemeral cache (CRIT-3). Split out of thumbnails.ts for Q-2.

export class InvalidThumbnailError extends Error {
  constructor(readonly trigger: string) {
    super(`thumbnail model returned unusable output for ${trigger}`);
    this.name = "InvalidThumbnailError";
  }
}

export type BriefUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheHit: boolean;
};

export type BriefResult = {
  brief: ThumbnailBrief;
  contrastFixed: boolean;
  contrastPassed: boolean;
  truncated: boolean;
  typeDriven: boolean;
  usage: BriefUsage;
};

type SystemBlock = CallClaudeInput["system"];
type Trigger = ThumbnailPromptInput["trigger"];

function safeJsonParse(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const ROLES = ["primary", "accent", "background", "contrast"] as const;

function coercePalette(raw: unknown): PaletteSwatch[] | null {
  if (!Array.isArray(raw)) return null;
  const byRole = new Map<string, string>();
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const hexRaw = (s as Record<string, unknown>).hex;
    const role = (s as Record<string, unknown>).role;
    if (typeof hexRaw !== "string") continue;
    const hex = hexRaw.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
    if (PaletteRoleSchema.safeParse(role).success && !byRole.has(role as string)) {
      byRole.set(role as string, hex);
    }
  }
  if (!ROLES.every((r) => byRole.has(r))) return null;
  return ROLES.map((role) => ({ hex: byRole.get(role)!, role }));
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Build a schema-shaped draft (no generatedAt) from raw model output. Returns
// null when a hard field can't be salvaged (triggers one re-prompt).
function coerceDraft(
  raw: Record<string, unknown>,
  trigger: Trigger,
  title: string,
): { draft: Omit<ThumbnailBrief, "generatedAt">; typeDriven: boolean } | null {
  const palette = coercePalette(raw.palette);
  if (!palette) return null;

  const composition = str(raw.composition, 280);
  const backgroundConcept = str(raw.backgroundConcept, 300);
  const whyItWorks = str(raw.whyItWorks, 400);
  if (composition.length < 20 || backgroundConcept.length < 20 || whyItWorks.length < 40) {
    return null;
  }

  const placement = CharacterPlacementSchema.safeParse(raw.characterPlacement).success
    ? (raw.characterPlacement as ThumbnailBrief["characterPlacement"])
    : "none";
  let facialExpression = str(raw.facialExpression, 200);
  if (placement === "none") facialExpression = "";
  else if (facialExpression.length < 8) facialExpression = "neutral, direct gaze to camera";

  const focalPoint = FocalPointSchema.safeParse(raw.focalPoint).success
    ? (raw.focalPoint as ThumbnailBrief["focalPoint"])
    : "middle-center";

  const ot = (raw.overlayText ?? {}) as Record<string, unknown>;
  let text = str(ot.text, 40);
  let words = wordCountOf(text);
  let truncated = false;
  if (words > 5) {
    text = text.split(/\s+/).slice(0, 5).join(" ");
    words = 5;
    truncated = true;
  }
  if (words < 3 || text.length === 0) return null;
  let color = typeof ot.color === "string" ? ot.color.trim().toLowerCase() : "";
  if (!palette.some((p) => p.hex === color)) {
    color = palette.find((p) => p.role === "contrast")!.hex;
  }

  const validChips = StyleRegisterSchema.options;
  const chips = [
    ...new Set(
      (Array.isArray(raw.styleChips) ? raw.styleChips : []).filter(
        (c): c is ThumbnailBrief["styleChips"][number] =>
          (validChips as readonly string[]).includes(c as string),
      ),
    ),
  ].slice(0, 4);
  for (const d of validChips) {
    if (chips.length >= 2) break;
    if (!chips.includes(d)) chips.push(d);
  }

  const ff = (raw.feasibilityFlags ?? {}) as Record<string, unknown>;
  const typeDriven = placement === "none";

  return {
    typeDriven,
    draft: {
      trigger,
      pairsWithTitle: title.slice(0, 100), // use the real title, not the model's echo
      composition,
      focalPoint,
      characterPlacement: placement,
      facialExpression,
      palette,
      backgroundConcept,
      overlayText: { text, wordCount: words, color },
      styleChips: chips,
      whyItWorks,
      feasibilityFlags: {
        requiresCreatorFace: ff.requiresCreatorFace === true || placement !== "none",
        requiresStockAsset: ff.requiresStockAsset === true,
        typeDrivenOnly: typeDriven,
      },
      truncationOccurred: truncated,
    },
  };
}

// Overlay text must not echo a ≥3-word run of the title.
function isEcho(overlay: string, title: string): boolean {
  const o = overlay.toLowerCase().replace(/[^\w\s]/g, "").trim();
  if (wordCountOf(o) < 3) return false;
  return title.toLowerCase().replace(/[^\w\s]/g, "").includes(o);
}

function usageOf(msg: Awaited<ReturnType<typeof callClaude>>): BriefUsage {
  const u = msg.usage;
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cachedInputTokens: cached,
    cacheHit: cached > 0,
  };
}

async function callOnce(
  system: SystemBlock,
  input: ThumbnailPromptInput,
): Promise<{ raw: Record<string, unknown> | null; usage: BriefUsage }> {
  const msg = await callClaude({
    stage: "thumbnails",
    system,
    messages: [{ role: "user", content: buildThumbnailUserPrompt(input) }],
    maxTokens: 900,
  });
  return { raw: safeJsonParse(extractTextFromMessage(msg)), usage: usageOf(msg) };
}

export async function generateOneBrief(
  system: SystemBlock,
  input: ThumbnailPromptInput,
): Promise<BriefResult> {
  const first = await callOnce(system, input);
  let coerced = first.raw ? coerceDraft(first.raw, input.trigger, input.title) : null;
  let usage = first.usage;

  const echo = coerced ? isEcho(coerced.draft.overlayText.text, input.title) : false;
  if (!coerced || echo) {
    const retry = await callOnce(system, {
      ...input,
      avoidComposition: coerced?.draft.composition ?? null,
    });
    usage = retry.usage;
    coerced = retry.raw ? coerceDraft(retry.raw, input.trigger, input.title) : null;
    if (!coerced) throw new InvalidThumbnailError(input.trigger);
  }

  const stamped: ThumbnailBrief = {
    ...coerced.draft,
    generatedAt: new Date().toISOString(),
  };
  const parsed = ThumbnailBriefSchema.safeParse(stamped);
  if (!parsed.success) throw new InvalidThumbnailError(input.trigger);

  const { brief, fixed, passed } = enforceOverlayContrast(parsed.data);
  return {
    brief,
    contrastFixed: fixed,
    contrastPassed: passed,
    truncated: coerced.draft.truncationOccurred,
    typeDriven: coerced.typeDriven,
    usage,
  };
}
