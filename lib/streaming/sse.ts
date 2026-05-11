import "server-only";

const ENCODER = new TextEncoder();

export type SSEErrorPayload = { code: string; message: string };

export type SSEStream<TProgress, TComplete> = {
  response: Response;
  emitProgress: (data: TProgress) => void;
  emitComplete: (data: TComplete) => void;
  emitError: (data: SSEErrorPayload) => void;
  close: () => void;
};

export function createSSEStream<
  TProgress,
  TComplete,
>(): SSEStream<TProgress, TComplete> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;

  function frame(event: string, data: unknown): Uint8Array {
    return ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function safeWrite(event: string, data: unknown): void {
    if (closed) return;
    writer.write(frame(event, data)).catch(() => {
      closed = true;
    });
  }

  function safeClose(): void {
    if (closed) return;
    closed = true;
    writer.close().catch(() => {
      /* ignore */
    });
  }

  return {
    response: new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }),
    emitProgress: (data) => safeWrite("progress", data),
    emitComplete: (data) => {
      safeWrite("complete", data);
      safeClose();
    },
    emitError: (data) => {
      safeWrite("error", data);
      safeClose();
    },
    close: safeClose,
  };
}
