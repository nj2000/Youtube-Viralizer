import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readScriptData } from "@/lib/db/script";
import type { ScriptData } from "@/lib/validation/script";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Renders the structured script as teleprompter plain text with bracketed
// [SKELETON] / [PERSONALITY] markers in prose form (the marker fields are the
// source of truth; brackets are presentation-only).
function toPlainText(data: ScriptData): string {
  const lines: string[] = [];
  for (const section of data.sections) {
    lines.push(`## ${mmss(section.startSec)} — ${section.title}`);
    lines.push("");
    for (const p of section.paragraphs) {
      if (p.marker === "skeleton") lines.push(`[SKELETON] ${p.text}`);
      else if (p.marker === "personality") {
        lines.push(
          `[PERSONALITY${p.personalityPrompt ? `: ${p.personalityPrompt}` : ""}] ${p.text}`,
        );
      } else lines.push(p.text);
    }
    for (const cue of section.brollCues) lines.push(`(B-ROLL) ${cue.cue}`);
    if (section.retentionRehook) lines.push(`(REHOOK) ${section.retentionRehook}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const idParsed = RunIdSchema.safeParse(url.searchParams.get("runId") ?? "");
  if (!idParsed.success) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "runId query param required." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const data = await readScriptData({ runId: idParsed.data, userId: user.id });
  if (!data) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "No script for this run." },
      { status: 404 },
    );
  }

  return new Response(toPlainText(data), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="script-${idParsed.data.slice(0, 8)}.txt"`,
    },
  });
}
