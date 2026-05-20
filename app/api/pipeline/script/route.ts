import { type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runFromStage } from "@/lib/services/pipeline";
import { publish } from "@/lib/services/pipeline-bus";
import {
  MissingScriptPrereqError,
  ScriptFormatViolationError,
  generateScript,
  type ScriptStreamEmitter,
} from "@/lib/services/script";
import {
  BudgetExceededError,
  ScriptRateLimitedError,
} from "@/lib/services/script-budget";
import { ScriptTargetMinutesSchema } from "@/lib/validation/script";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  targetMinutes: ScriptTargetMinutesSchema.default(8),
});

// Best-effort single-instance concurrency guard. A durable guard would need a
// status column; this catches the common multi-tab case on one server.
const inFlight = new Set<string>();

const encoder = new TextEncoder();
function frame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return jsonError(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "VALIDATION_FAILED", "Body must be JSON.");
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", "Invalid runId / targetMinutes.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, parsed.data.runId);
  if (!row || row.user_id !== user.id) {
    return jsonError(404, "RUN_NOT_FOUND", "Run not found.");
  }
  if (inFlight.has(parsed.data.runId)) {
    return jsonError(409, "STREAM_IN_PROGRESS", "Script is already generating.");
  }

  const runId = parsed.data.runId;
  const userId = user.id;
  const targetMinutes = parsed.data.targetMinutes;
  inFlight.add(runId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(frame(event, data));
        } catch {
          closed = true;
        }
      };
      const emit: ScriptStreamEmitter = {
        progress: (message) => send("progress", { stage: 7, message }),
        sectionChunk: (d) => send("section_chunk", d),
        sectionComplete: (d) => send("section_complete", d),
        rehookInserted: (d) => send("rehook_inserted", d),
        loopOpened: (d) => send("loop_opened", d),
        loopClosed: (d) => send("loop_closed", d),
      };

      try {
        const scriptData = await generateScript({
          runId,
          userId,
          run: row,
          targetMinutes,
          emit,
        });
        send("complete", scriptData);
        // Auto-queue Stage 8 (lint) after a full script completes.
        void runFromStage(runId, userId, "lint").catch(async (err) => {
          await publish(runId, {
            event: "run_error",
            payload: {
              runId,
              stage: 8,
              code: err instanceof Error ? err.name : "INTERNAL_ERROR",
            },
          });
        });
      } catch (err) {
        const code =
          err instanceof MissingScriptPrereqError
            ? "MISSING_PREREQUISITES"
            : err instanceof BudgetExceededError
              ? "BUDGET_EXCEEDED"
              : err instanceof ScriptRateLimitedError
                ? "RATE_LIMITED"
                : err instanceof ScriptFormatViolationError
                  ? "FORMAT_VIOLATION"
                  : "UPSTREAM_ERROR";
        send("error", { code, message: "Script generation failed." });
      } finally {
        inFlight.delete(runId);
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      inFlight.delete(runId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
