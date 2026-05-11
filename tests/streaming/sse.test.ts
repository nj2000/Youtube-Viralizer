import { describe, expect, it } from "vitest";

import { parseSSEEvent } from "@/lib/hooks/useStageStream";
import { createSSEStream } from "@/lib/streaming/sse";

async function readAllText(response: Response): Promise<string> {
  return await response.text();
}

describe("createSSEStream (TS-2 SSE pattern)", () => {
  it("sets the required SSE response headers", () => {
    const { response, close } = createSSEStream();
    expect(response.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    close();
  });

  it("frames progress and complete events in the documented `event:/data:` shape", async () => {
    const { response, emitProgress, emitComplete } = createSSEStream<
      { step: string },
      { value: number }
    >();
    emitProgress({ step: "loading" });
    emitComplete({ value: 42 });
    const body = await readAllText(response);
    expect(body).toMatch(/^event: progress\ndata: \{"step":"loading"\}\n\n/);
    expect(body).toContain('event: complete\ndata: {"value":42}\n\n');
  });

  it("emits an error event and closes the stream", async () => {
    const { response, emitError } = createSSEStream();
    emitError({ code: "UPSTREAM_ERROR", message: "boom" });
    const body = await readAllText(response);
    expect(body).toContain(
      'event: error\ndata: {"code":"UPSTREAM_ERROR","message":"boom"}',
    );
  });

  it("ignores writes after close()", async () => {
    const { response, emitComplete, emitProgress } = createSSEStream<
      { step: string },
      null
    >();
    emitComplete(null);
    emitProgress({ step: "too-late" }); // should not appear
    const body = await readAllText(response);
    expect(body).not.toContain("too-late");
  });
});

describe("parseSSEEvent (client-side parser)", () => {
  it("parses a single-line data event", () => {
    expect(parseSSEEvent('event: progress\ndata: {"step":"x"}')).toEqual({
      name: "progress",
      data: { step: "x" },
    });
  });

  it("falls back to a string when JSON parsing fails", () => {
    expect(parseSSEEvent("event: status\ndata: not-json")).toEqual({
      name: "status",
      data: "not-json",
    });
  });

  it("skips comment lines starting with :", () => {
    expect(parseSSEEvent(":keepalive\nevent: ping\ndata: 1")).toEqual({
      name: "ping",
      data: 1,
    });
  });

  it("returns null when no data lines are present", () => {
    expect(parseSSEEvent("event: empty")).toBeNull();
  });
});
