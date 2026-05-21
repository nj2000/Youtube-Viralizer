import { z } from "zod";

// CRIT-2: Stage 10 outputs are templated/short → Haiku 4.5 for the 5 LLM
// sub-calls; chapters are derived deterministically (no model).
export const SEO_MODEL = "claude-haiku-4-5-20251001";

export const DESCRIPTION_MAX_CHARS = 5000;
export const TAGS_JOINED_MAX_CHARS = 500;
export const CHAPTER_MIN_GAP_SEC = 10;

// ── Description ───────────────────────────────────────────────────────────────

export const DescriptionSchema = z.object({
  body: z.string().min(80).max(DESCRIPTION_MAX_CHARS),
  aboveFold: z.string().min(40).max(300), // first 2 lines (visible preview)
  wordCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type Description = z.infer<typeof DescriptionSchema>;

// ── Tags ──────────────────────────────────────────────────────────────────────

export const TagSchema = z.string().min(2).max(30).regex(/^[a-z0-9 .'-]+$/i);

export const TagsSchema = z
  .array(TagSchema)
  .min(8)
  .max(15)
  .refine((tags) => tags.join(",").length <= TAGS_JOINED_MAX_CHARS, {
    message: `joined tags must be ≤ ${TAGS_JOINED_MAX_CHARS} chars`,
  })
  .refine(
    (tags) => new Set(tags.map((t) => t.toLowerCase())).size === tags.length,
    { message: "tags must be unique (case-insensitive)" },
  );
export type Tags = z.infer<typeof TagsSchema>;

// ── Hashtags ──────────────────────────────────────────────────────────────────

const HashtagSchema = z.string().regex(/^#[a-z0-9]{1,29}$/i);

export const HashtagsSchema = z.object({
  primary: z.array(HashtagSchema).length(3),
  optional: z.array(HashtagSchema).length(5),
});
export type Hashtags = z.infer<typeof HashtagsSchema>;

// ── Chapters (deterministic) ──────────────────────────────────────────────────

export const ChapterSchema = z.object({
  timeSec: z.number().int().nonnegative(),
  label: z.string().min(4).max(80),
  fallback: z.boolean(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ChaptersSchema = z
  .array(ChapterSchema)
  .min(3)
  .max(10)
  .refine((chs) => chs[0]?.timeSec === 0, {
    message: "first chapter must be 0:00",
  })
  .refine(
    (chs) =>
      chs.every(
        (c, i) => i === 0 || c.timeSec - chs[i - 1]!.timeSec >= CHAPTER_MIN_GAP_SEC,
      ),
    { message: `chapters must be ≥ ${CHAPTER_MIN_GAP_SEC}s apart` },
  );
export type Chapters = z.infer<typeof ChaptersSchema>;

// ── End screen ────────────────────────────────────────────────────────────────

export const EndScreenVideoSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().min(1).max(500),
  reason: z.string().min(60).max(280),
  affinityType: z.enum(["most_watched", "high_affinity"]),
});
export type EndScreenVideo = z.infer<typeof EndScreenVideoSchema>;

export const EndScreenSuggestionsSchema = z.object({
  videos: z.array(EndScreenVideoSchema).max(2),
  subscribePrompt: z.object({
    placement: z.enum(["split", "full_frame"]),
    cta: z.string().min(40).max(280),
  }),
});
export type EndScreenSuggestions = z.infer<typeof EndScreenSuggestionsSchema>;

// ── Pinned comment ────────────────────────────────────────────────────────────

export const PinnedCommentDraftSchema = z.object({
  body: z.string().min(80).max(700),
  template: z.literal("tiered_cta"), // only template in Phase 1
});
export type PinnedCommentDraft = z.infer<typeof PinnedCommentDraftSchema>;

// ── Flags + counts ────────────────────────────────────────────────────────────

export const SeoFlagsSchema = z.object({
  descriptionTruncated: z.boolean(),
  tagsTrimmed: z.boolean(),
  tagsTrimmedList: z.array(TagSchema).max(5),
  chaptersFallback: z.boolean(),
  sponsoredDisclosure: z.boolean(),
  complianceDisclaimer: z.boolean(),
  endScreenSubscribeOnly: z.boolean(),
});

export const SeoSectionSchema = z.enum([
  "description",
  "tags",
  "hashtags",
  "chapters",
  "endScreen",
  "pinnedComment",
]);
export type SeoSection = z.infer<typeof SeoSectionSchema>;

const RegenerationCountsSchema = z.object({
  description: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
  hashtags: z.number().int().nonnegative(),
  chapters: z.number().int().nonnegative(),
  endScreen: z.number().int().nonnegative(),
  pinnedComment: z.number().int().nonnegative(),
});

// ── Top-level ─────────────────────────────────────────────────────────────────

export const SeoDataSchema = z.object({
  description: DescriptionSchema,
  tags: TagsSchema,
  hashtags: HashtagsSchema,
  chapters: ChaptersSchema,
  endScreenSuggestions: EndScreenSuggestionsSchema,
  pinnedCommentDraft: PinnedCommentDraftSchema,
  flags: SeoFlagsSchema,
  regenerationCounts: RegenerationCountsSchema,
  model: z.literal(SEO_MODEL),
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
});
export type SeoData = z.infer<typeof SeoDataSchema>;
