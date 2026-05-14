"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useChannelContext } from "./ChannelContextProvider";

function ChannelAvatar({ title }: { title: string }) {
  const initial = title.charAt(0).toUpperCase() || "C";
  return (
    <span className="h-6 w-6 rounded-full bg-gradient-to-br from-yt-500 to-orange-500 flex items-center justify-center text-white text-[10px] font-bold">
      {initial}
    </span>
  );
}

export function ChannelSwitcher() {
  const { channels, activeChannelId, channelLimit, setActive } =
    useChannelContext();
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

  if (channels.length === 0) {
    return (
      <Link
        href="/onboard"
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 rounded-lg px-3 py-1.5 transition text-sm font-medium text-white"
      >
        Connect a channel
      </Link>
    );
  }

  const active = channels.find((c) => c.id === activeChannelId) ?? channels[0]!;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 rounded-lg px-3 py-1.5 transition"
      >
        <ChannelAvatar title={active.title} />
        <span className="text-sm font-medium text-white max-w-[18ch] truncate">
          {active.title}
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
              Your channels
            </p>
          </div>
          <ul className="py-1">
            {channels.map((channel) => {
              const isActive = channel.id === activeChannelId;
              return (
                <li key={channel.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isActive) void setActive(channel.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${
                      isActive
                        ? "bg-yt-600/10 ring-1 ring-inset ring-yt-600/20"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <ChannelAvatar title={channel.title} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-white truncate">
                        {channel.title}
                      </span>
                      <span className="block text-[11px] text-ink-400 truncate">
                        {channel.niche ?? "Niche pending"}
                      </span>
                    </span>
                    {isActive && (
                      <svg
                        className="h-4 w-4 text-yt-500"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {channels.length < channelLimit && (
            <Link
              href="/onboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 border-t border-white/5 hover:bg-white/5 text-yt-400 hover:text-yt-300 font-medium transition"
            >
              <span className="h-5 w-5 rounded-full border border-dashed border-yt-500/60 flex items-center justify-center text-yt-500">
                +
              </span>
              <span className="text-sm">Add another channel</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
