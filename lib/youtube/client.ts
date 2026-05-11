import "server-only";

import { google, type youtube_v3 } from "googleapis";

import { env } from "@/lib/env";

export const youtubeClient: youtube_v3.Youtube = google.youtube({
  version: "v3",
  auth: env.YOUTUBE_API_KEY,
});
