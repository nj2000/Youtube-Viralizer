"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_CHARS = 500;
const MIN_CHARS = 10;

export function IdeaForm() {
  const router = useRouter();
  const [ideaText, setIdeaText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLength = ideaText.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < MIN_CHARS;
  const tooLong = ideaText.length > MAX_CHARS;
  const disabled =
    submitting ||
    trimmedLength < MIN_CHARS ||
    trimmedLength > MAX_CHARS ||
    tooLong;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (trimmedLength < MIN_CHARS) {
      setError("Add at least 10 characters so we have something to work with.");
      return;
    }
    if (trimmedLength > MAX_CHARS) {
      setError("Trim to 500 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaText: ideaText.trim() }),
      });
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({}))) as { code?: string; message?: string };
        if (body.code === "NO_ACTIVE_CHANNEL") {
          router.push("/onboard");
          return;
        }
        setError(
          body.message ??
            "Couldn't start the run. Please try again in a moment.",
        );
        setSubmitting(false);
        return;
      }
      const data: { runId: string } = await res.json();
      router.push(`/runs/${data.runId}`);
    } catch {
      setError("Couldn't start the run. Please try again in a moment.");
      setSubmitting(false);
    }
  }

  const inputErrorClass = tooShort || tooLong || error ? "input-error" : "";

  return (
    <form onSubmit={handleSubmit}>
      <label
        htmlFor="idea"
        className="block text-sm font-medium text-ink-200 mb-2"
      >
        Your video idea
      </label>
      <textarea
        id="idea"
        rows={4}
        maxLength={MAX_CHARS + 100}
        value={ideaText}
        onChange={(e) => {
          setIdeaText(e.target.value);
          setError(null);
        }}
        placeholder="e.g. How I built a $10k SaaS in 30 days using Claude Code as my only developer"
        className={`input w-full rounded-lg px-4 py-3 text-sm resize-none ${inputErrorClass}`}
        disabled={submitting}
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-ink-400">
          A sentence or two is enough. We&apos;ll handle title and angle
          generation.
        </p>
        <p
          className={`text-xs font-mono ${tooLong ? "text-rose-400" : "text-ink-500"}`}
        >
          {ideaText.length} / {MAX_CHARS}
        </p>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-2 text-sm text-rose-400">
          <svg
            className="h-3.5 w-3.5 mt-0.5 shrink-0"
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
          <span>{error}</span>
        </p>
      )}

      <p className="mt-3 text-xs text-ink-400">
        10–500 characters · plain text, no formatting
      </p>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-ink-400 flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          Typical run takes 60–90s
        </p>
        <button
          type="submit"
          disabled={disabled}
          className="btn-primary rounded-lg px-5 py-3 text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Starting…" : "Run pipeline"}
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
      </div>
    </form>
  );
}
