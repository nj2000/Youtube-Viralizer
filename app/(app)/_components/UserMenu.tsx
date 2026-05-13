"use client";

import { useEffect, useRef, useState } from "react";

import { signOutAction } from "./signOutAction";

export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = email.charAt(0).toUpperCase() || "U";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 rounded-lg px-3 py-1.5 transition"
      >
        <span className="h-6 w-6 rounded-full bg-gradient-to-br from-yt-500 to-orange-500 flex items-center justify-center text-white text-[10px] font-bold">
          {initial}
        </span>
        <span className="text-sm font-medium text-white max-w-[18ch] truncate">
          {email}
        </span>
        <svg
          className="h-4 w-4 text-ink-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.4a.75.75 0 0 1-1.08 0l-4.25-4.4a.75.75 0 0 1 .02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-2 w-72 rounded-xl overflow-hidden z-10 card"
          style={{ background: "#13131a" }}
        >
          <div className="px-4 py-3 border-b border-white/5">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400">
              Signed in as
            </p>
            <p className="text-sm font-semibold text-white truncate mt-0.5">
              {email}
            </p>
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Session active · expires in 30 days
            </div>
          </div>

          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-rose-500/5 text-rose-400 hover:text-rose-300 font-medium transition text-left"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="text-sm">Sign out</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
