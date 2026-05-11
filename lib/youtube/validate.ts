import { InvalidChannelError } from "./errors";

export type ParsedChannelInput =
  | { kind: "handle"; value: string }
  | { kind: "id"; value: string }
  | { kind: "custom"; value: string }
  | { kind: "video"; value: string }
  | { kind: "short_video"; value: string };

const HANDLE_RE = /^[a-zA-Z0-9._-]{3,30}$/;
const CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/;
const CUSTOM_RE = /^[a-zA-Z0-9._-]+$/;
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function parseChannelInput(input: string): ParsedChannelInput {
  if (typeof input !== "string") throw new InvalidChannelError(String(input));
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidChannelError(input);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidChannelError(input);
  }

  if (url.protocol !== "https:") throw new InvalidChannelError(input);

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");

  if (host === "youtu.be") {
    const id = path.replace(/^\/+/, "").split("/")[0] ?? "";
    if (VIDEO_ID_RE.test(id)) return { kind: "short_video", value: id };
    throw new InvalidChannelError(input);
  }

  if (host !== "youtube.com" && host !== "www.youtube.com") {
    throw new InvalidChannelError(input);
  }

  if (path.startsWith("/@")) {
    const handle = path.slice(2);
    if (HANDLE_RE.test(handle)) return { kind: "handle", value: handle };
    throw new InvalidChannelError(input);
  }

  if (path.startsWith("/channel/")) {
    const id = path.slice("/channel/".length);
    if (CHANNEL_ID_RE.test(id)) return { kind: "id", value: id };
    throw new InvalidChannelError(input);
  }

  if (path.startsWith("/c/")) {
    const name = path.slice("/c/".length);
    if (CUSTOM_RE.test(name)) return { kind: "custom", value: name };
    throw new InvalidChannelError(input);
  }

  if (path === "/watch") {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) return { kind: "video", value: v };
    throw new InvalidChannelError(input);
  }

  throw new InvalidChannelError(input);
}
