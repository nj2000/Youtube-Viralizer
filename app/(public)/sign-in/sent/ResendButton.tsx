"use client";

import { useEffect, useState } from "react";

const COOLDOWN_SECONDS = 30;

export function ResendButton({
  email,
  next,
}: {
  email: string;
  next: string | null;
}) {
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function handleResend() {
    setSending(true);
    setStatus("idle");
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(next ? { next } : {}) }),
      });
      if (response.status === 204) {
        setStatus("sent");
        setCooldown(COOLDOWN_SECONDS);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setSending(false);
    }
  }

  const disabled = sending || cooldown > 0;

  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <p className="text-xs text-ink-400">
        {cooldown > 0 ? (
          <>
            Check spam, or resend in{" "}
            <span className="font-mono text-ink-300">{cooldown}s</span>.
          </>
        ) : status === "sent" ? (
          <span className="text-emerald-400">
            Sent again — check your inbox.
          </span>
        ) : status === "error" ? (
          <span className="text-rose-400">
            Couldn&apos;t resend. Try again in a moment.
          </span>
        ) : (
          "Resend the link now."
        )}
      </p>
      <button
        type="button"
        onClick={handleResend}
        disabled={disabled}
        className={`px-4 py-2 text-sm font-semibold rounded-lg ring-1 transition ${
          disabled
            ? "bg-white/5 text-ink-500 ring-white/5 cursor-not-allowed"
            : "bg-white/10 hover:bg-white/15 text-white ring-white/10"
        }`}
      >
        {sending ? "Sending…" : "Resend link"}
      </button>
    </div>
  );
}
