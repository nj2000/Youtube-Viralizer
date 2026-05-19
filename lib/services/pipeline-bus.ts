import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// We read env vars via process.env (rather than the validated `env` export)
// so this module doesn't trigger Zod env validation at import time. The
// service-role key + URL are already validated at app boot in lib/env.ts,
// and this file's runtime callers only fire after a successful boot. The
// indirection keeps Vitest specs (which don't have .env.local) importable.
function busEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "pipeline-bus: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured",
    );
  }
  return { url, key };
}

// Bus events emitted on the `run:<runId>` topic. The SSE proxy translates
// these into Server-Sent Events with the same event names.
export type RunBusEvent =
  | {
      event: "progress";
      payload: {
        stage: number;
        message: string;
        tokensSoFar?: number;
        tokensTotalEstimate?: number;
      };
    }
  | {
      event: "stage_complete";
      payload: { stage: number };
    }
  | {
      event: "run_complete";
      payload: { runId: string };
    }
  | {
      event: "run_gated";
      payload: { runId: string; score: number };
    }
  | {
      event: "run_error";
      payload: { runId: string; stage: number | null; code: string };
    };

function topicFor(runId: string): string {
  return `run:${runId}`;
}

// Server-side publish via Supabase Realtime's HTTP broadcast endpoint. The
// HTTP path avoids the WebSocket connection overhead the JS SDK incurs for
// `channel.send()`. Service-role auth bypasses Realtime RLS.
export async function publish(
  runId: string,
  event: RunBusEvent,
): Promise<void> {
  let url: string;
  let key: string;
  try {
    ({ url, key } = busEnv());
  } catch {
    // Bus is best-effort: persisted state is the source of truth.
    return;
  }

  const body = {
    messages: [
      {
        topic: topicFor(runId),
        event: event.event,
        payload: event.payload,
        private: false,
      },
    ],
  };

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Broadcast is best-effort: SSE subscribers re-snapshot from the DB if
    // they miss an event, and the persisted state (pipeline_runs row) is the
    // source of truth. Don't break a stage on a transient broadcast failure.
  }
}

export type BusSubscription = {
  unsubscribe: () => Promise<void>;
};

export async function subscribeToRun(
  runId: string,
  onEvent: (event: RunBusEvent) => void,
): Promise<BusSubscription> {
  const supabase = createSupabaseServiceClient();
  const channel = supabase.channel(topicFor(runId), {
    config: { broadcast: { self: false } },
  });

  channel.on("broadcast", { event: "progress" }, (msg) => {
    onEvent({
      event: "progress",
      payload: msg.payload as RunBusEvent["payload"],
    } as RunBusEvent);
  });
  channel.on("broadcast", { event: "stage_complete" }, (msg) => {
    onEvent({
      event: "stage_complete",
      payload: msg.payload as RunBusEvent["payload"],
    } as RunBusEvent);
  });
  channel.on("broadcast", { event: "run_complete" }, (msg) => {
    onEvent({
      event: "run_complete",
      payload: msg.payload as RunBusEvent["payload"],
    } as RunBusEvent);
  });
  channel.on("broadcast", { event: "run_gated" }, (msg) => {
    onEvent({
      event: "run_gated",
      payload: msg.payload as RunBusEvent["payload"],
    } as RunBusEvent);
  });
  channel.on("broadcast", { event: "run_error" }, (msg) => {
    onEvent({
      event: "run_error",
      payload: msg.payload as RunBusEvent["payload"],
    } as RunBusEvent);
  });

  await channel.subscribe();

  return {
    unsubscribe: async () => {
      await supabase.removeChannel(channel);
    },
  };
}
