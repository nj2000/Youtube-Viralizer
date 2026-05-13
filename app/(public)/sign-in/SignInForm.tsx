"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type BannerKind = "rate_limited" | "send_failed" | null;

type Banner = {
  kind: BannerKind;
  retryAfterSec?: number;
};

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

export function SignInForm({ initialNext }: { initialNext: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>({ kind: null });
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInlineError(null);
    setBanner({ kind: null });
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(initialNext ? { next: initialNext } : {}),
        }),
      });

      if (response.status === 204) {
        const qs = new URLSearchParams({ email });
        if (initialNext) qs.set("next", initialNext);
        router.push(`/sign-in/sent?${qs.toString()}`);
        return;
      }

      if (response.status === 400) {
        setInlineError(
          "That doesn't look like a complete email address. Try name@domain.com.",
        );
        return;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
        setBanner({ kind: "rate_limited", retryAfterSec: retryAfter });
        setCooldown(retryAfter);
        return;
      }

      setBanner({ kind: "send_failed" });
    } catch {
      setBanner({ kind: "send_failed" });
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || cooldown > 0;
  const buttonLabel = submitting
    ? "Sending link…"
    : cooldown > 0
      ? `Try again in ${formatCountdown(cooldown)}`
      : banner.kind === "send_failed"
        ? "Retry send"
        : "Send link";

  const cardErrorStyle =
    inlineError !== null
      ? { borderColor: "rgba(239,68,68,0.25)" as const }
      : undefined;

  return (
    <div className="card rounded-2xl px-8 py-10" style={cardErrorStyle}>
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
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          Sign in to Viralizer
        </h1>
        <p className="text-ink-300 mt-3 text-sm">
          We&apos;ll email you a sign-in link — no password needed. New here?
          Same flow signs you up.
        </p>
      </div>

      {banner.kind === "rate_limited" && (
        <div
          className="rounded-xl p-4 mt-6 flex items-start gap-3"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.25)",
          }}
        >
          <div className="h-7 w-7 rounded-full bg-amber-500/20 ring-1 ring-amber-500/40 flex items-center justify-center shrink-0">
            <svg
              className="h-4 w-4 text-amber-400"
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
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-200">
              We&apos;ve sent several links recently
            </p>
            <p className="text-sm text-amber-300/80 mt-1">
              Check your inbox (and spam) — or wait a few minutes before trying
              again. Limit: 5 links per hour.
            </p>
          </div>
        </div>
      )}

      {banner.kind === "send_failed" && (
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
              Couldn&apos;t send right now
            </p>
            <p className="text-sm text-rose-300/80 mt-1">
              Our email provider didn&apos;t respond. Please try again in a
              minute. If it keeps happening, ping us at{" "}
              <span className="font-mono">help@viralizer.app</span>.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-ink-200 mb-2"
          >
            Your email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            placeholder="you@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className={`input w-full rounded-lg px-4 py-3 text-sm ${
              inlineError ? "input-error" : ""
            }`}
          />
          {inlineError && (
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
              <span>{inlineError}</span>
            </p>
          )}
          {!inlineError && (
            <p className="mt-2 text-xs text-ink-400">
              We&apos;ll never send marketing without asking first.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={disabled}
          className="btn-primary w-full rounded-lg px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2"
        >
          {submitting && (
            <svg
              className="h-4 w-4 spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          <span>{buttonLabel}</span>
        </button>

        <p className="text-center text-xs text-ink-400 flex items-center justify-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Passwordless. Links expire after 15 minutes.
        </p>
      </form>
    </div>
  );
}
