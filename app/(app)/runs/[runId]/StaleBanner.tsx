"use client";

export function StaleBanner() {
  return (
    <section
      className="rounded-xl p-4 mb-6 flex items-start gap-3"
      style={{
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.20)",
      }}
    >
      <span className="h-6 w-6 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
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
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </span>
      <p className="text-sm text-amber-200">
        Some downstream stages use older inputs and may no longer match. Click
        <span className="font-semibold"> Regenerate</span> on any stale stage to
        refresh it.
      </p>
    </section>
  );
}
