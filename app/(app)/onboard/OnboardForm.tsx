"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_COPY: Record<string, { heading: string; body: string }> = {
  INVALID_URL: {
    heading: "We couldn't find that channel",
    body: "Make sure it's a YouTube channel URL — not a video or playlist.",
  },
  CHANNEL_NOT_FOUND: {
    heading: "We couldn't find that channel",
    body: "Make sure it's a YouTube channel URL — not a video or playlist.",
  },
  CHANNEL_PRIVATE: {
    heading: "That channel is private",
    body: "We can only analyze public channels for now.",
  },
  CHANNEL_TERMINATED: {
    heading: "That channel has been terminated",
    body: "YouTube has removed this channel. Try a different one.",
  },
  QUOTA_EXCEEDED: {
    heading: "We're temporarily over capacity",
    body: "Try again in a few hours.",
  },
  UPSTREAM_ERROR: {
    heading: "YouTube didn't respond",
    body: "Please try again in a minute.",
  },
  INTERNAL_ERROR: {
    heading: "Something went wrong",
    body: "Please try again.",
  },
};

export function OnboardForm({ initialError }: { initialError: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(initialError);

  const errorContent = errorCode ? ERROR_COPY[errorCode] : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorCode(null);
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      setErrorCode("INVALID_URL");
      return;
    }
    router.push(`/onboard/processing?url=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="card rounded-2xl px-8 py-10">
      <div className="flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-b from-yt-500 to-yt-700 shadow-glow-yt flex items-center justify-center mb-5">
          <svg
            className="h-7 w-7 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m23 7-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          Connect your channel
        </h1>
        <p className="text-ink-300 mt-3 text-sm max-w-md">
          We&apos;ll analyze your niche, top videos, and competitors so every kit
          you generate is grounded in your actual channel.
        </p>
      </div>

      {errorContent && (
        <div
          className="rounded-xl p-4 mt-6 flex items-start gap-3"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          <div className="h-7 w-7 rounded-full bg-rose-500/20 ring-1 ring-rose-500/40 flex items-center justify-center shrink-0">
            <svg
              className="h-4 w-4 text-rose-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-rose-200">
              {errorContent.heading}
            </p>
            <p className="text-sm text-rose-300/80 mt-1">{errorContent.body}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="channel-url"
            className="block text-sm font-medium text-ink-200 mb-2"
          >
            Your YouTube channel URL
          </label>
          <input
            id="channel-url"
            name="url"
            type="text"
            inputMode="url"
            required
            placeholder="youtube.com/@yourhandle"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={`input w-full rounded-lg px-4 py-3 text-sm ${
              errorContent ? "input-error" : ""
            }`}
          />
          <p className="mt-2 text-xs text-ink-400">
            Handle, channel ID, or video URL all work.
          </p>
        </div>

        <button
          type="submit"
          className="btn-primary w-full rounded-lg px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2"
        >
          Continue
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        <p className="text-center text-xs text-ink-400 flex items-center justify-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          We never post to your channel. Public data only.
        </p>
      </form>
    </div>
  );
}
