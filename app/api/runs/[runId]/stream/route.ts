import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  RunNotFoundForUserError,
  getRunForUser,
} from "@/lib/services/runs";
import {
  subscribeToRun,
  type RunBusEvent,
} from "@/lib/services/pipeline-bus";
import type { RunRowView, RunStatus } from "@/lib/validation/runs";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();
const TERMINAL: RunStatus[] = ["complete", "gated_failed", "error"];
const KEEPALIVE_INTERVAL_MS = 15_000;

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

const encoder = new TextEncoder();

function frame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function keepaliveFrame(): Uint8Array {
  return encoder.encode(`: keepalive\n\n`);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId: rawId } = await params;
  const parsed = RunIdSchema.safeParse(rawId);
  if (!parsed.success) return errorJson(404, "RUN_NOT_FOUND", "Run not found.");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  let initialRun: RunRowView;
  try {
    initialRun = await getRunForUser(supabase, {
      runId: parsed.data,
      userId: user.id,
    });
  } catch (err) {
    if (err instanceof RunNotFoundForUserError) {
      return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
    }
    throw err;
  }

  const runId = parsed.data;
  const userId = user.id;
  const isTerminal = TERMINAL.includes(initialRun.status);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      let subscription: { unsubscribe: () => Promise<void> } | null = null;

      function safeEnqueue(chunk: Uint8Array): void {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      }

      async function teardown(): Promise<void> {
        if (closed) return;
        closed = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        if (subscription) await subscription.unsubscribe().catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      // 1. Snapshot first (verification: <200ms).
      safeEnqueue(frame("snapshot", initialRun));

      if (isTerminal) {
        // Spec §4.6: terminal runs close after the snapshot.
        await teardown();
        return;
      }

      // 2. Subscribe to the bus and forward events.
      try {
        subscription = await subscribeToRun(runId, (event: RunBusEvent) => {
          safeEnqueue(frame(event.event, event.payload));

          // Terminal events close the stream.
          if (
            event.event === "run_complete" ||
            event.event === "run_gated" ||
            event.event === "run_error"
          ) {
            void teardown();
          }
        });
      } catch {
        safeEnqueue(
          frame("error", {
            code: "BUS_UNAVAILABLE",
            message: "Live updates are unavailable. Refresh to retry.",
          }),
        );
        await teardown();
        return;
      }

      // 3. Keepalive every 15s so proxies don't drop the connection.
      keepaliveTimer = setInterval(() => {
        safeEnqueue(keepaliveFrame());
      }, KEEPALIVE_INTERVAL_MS);

      // 4. After subscribe, re-fetch and emit a fresh snapshot in case the
      // run terminated during the subscribe handshake (avoids the
      // bus-message-lost edge case from the spec).
      try {
        const fresh = await getRunForUser(supabase, { runId, userId });
        if (TERMINAL.includes(fresh.status)) {
          safeEnqueue(frame("snapshot", fresh));
          await teardown();
        }
      } catch {
        // ignore — initial subscription is still active
      }
    },
    async cancel() {
      // Reader cancelled / EventSource.close() — handled inside `start` via
      // the closed flag; controller.error() during teardown is a no-op.
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
