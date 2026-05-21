import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getRunRow } from "@/lib/db/runs";
import { readSeoData } from "@/lib/db/seo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const QuerySchema = z.object({ runId: z.string().uuid() });

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// GET /api/pipeline/seo/copy-format?runId=… — the pack as copy-paste plain text
// for YouTube Studio.
export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse({
    runId: request.nextUrl.searchParams.get("runId"),
  });
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "runId required.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, parsed.data.runId);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }

  const seo = await readSeoData({ runId: parsed.data.runId, userId: user.id });
  if (!seo) return errorJson(404, "NOT_FOUND", "No SEO pack for this run.");

  const chaptersText = seo.chapters.map((c) => `${mmss(c.timeSec)} ${c.label}`).join("\n");
  const hashtagsLine = [...seo.hashtags.primary, ...seo.hashtags.optional].join(" ");

  return NextResponse.json({
    description: `${seo.description.body}\n\n${chaptersText}\n\n${hashtagsLine}`,
    tagsLine: seo.tags.join(", "),
    chapters: chaptersText,
    pinnedCommentBody: seo.pinnedCommentDraft.body,
  });
}
