import { describe, expect, it } from "vitest";

import { InvalidChannelError } from "@/lib/youtube/errors";
import { parseChannelInput } from "@/lib/youtube/validate";

describe("parseChannelInput (SEC-1 channel URL allowlist)", () => {
  it("accepts https handle URLs", () => {
    expect(parseChannelInput("https://youtube.com/@mkbhd")).toEqual({
      kind: "handle",
      value: "mkbhd",
    });
    expect(parseChannelInput("https://www.youtube.com/@mkbhd")).toEqual({
      kind: "handle",
      value: "mkbhd",
    });
  });

  it("accepts https channel-id URLs", () => {
    expect(
      parseChannelInput(
        "https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ",
      ),
    ).toEqual({ kind: "id", value: "UCBJycsmduvYEL83R_U4JriQ" });
  });

  it("accepts custom-name URLs", () => {
    expect(parseChannelInput("https://www.youtube.com/c/MarquesBrownlee")).toEqual({
      kind: "custom",
      value: "MarquesBrownlee",
    });
  });

  it("accepts video watch URLs and youtu.be short links", () => {
    expect(
      parseChannelInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toEqual({ kind: "video", value: "dQw4w9WgXcQ" });
    expect(parseChannelInput("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "short_video",
      value: "dQw4w9WgXcQ",
    });
  });

  it("rejects foreign domains", () => {
    expect(() => parseChannelInput("https://example.com/@mkbhd")).toThrow(
      InvalidChannelError,
    );
  });

  it("rejects http:// (must be https)", () => {
    expect(() => parseChannelInput("http://youtube.com/@mkbhd")).toThrow(
      InvalidChannelError,
    );
  });

  it("rejects empty string and whitespace", () => {
    expect(() => parseChannelInput("")).toThrow(InvalidChannelError);
    expect(() => parseChannelInput("   ")).toThrow(InvalidChannelError);
  });

  it("rejects malformed channel IDs", () => {
    expect(() =>
      parseChannelInput("https://youtube.com/channel/NOT-A-VALID-ID"),
    ).toThrow(InvalidChannelError);
  });

  it("rejects unknown youtube.com paths", () => {
    expect(() => parseChannelInput("https://youtube.com/feed/trending")).toThrow(
      InvalidChannelError,
    );
  });
});
