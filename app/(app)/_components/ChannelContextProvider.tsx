"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ChannelSummary = {
  id: string;
  youtubeChannelId: string;
  handle: string | null;
  title: string;
  niche: string | null;
  subscriberCount: number | null;
  isActive: boolean;
};

type ChannelContextValue = {
  channels: ChannelSummary[];
  activeChannelId: string | null;
  channelLimit: number;
  loading: boolean;
  refresh: () => Promise<void>;
  setActive: (channelId: string) => Promise<void>;
};

const ChannelContext = createContext<ChannelContextValue | null>(null);

export function useChannelContext(): ChannelContextValue {
  const ctx = useContext(ChannelContext);
  if (!ctx) {
    throw new Error("useChannelContext must be used inside ChannelContextProvider");
  }
  return ctx;
}

export function ChannelContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelLimit, setChannelLimit] = useState(3);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/channels", { cache: "no-store" });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data: {
        channels: ChannelSummary[];
        activeChannelId: string | null;
        channelLimit: number;
      } = await res.json();
      setChannels(data.channels);
      setActiveChannelId(data.activeChannelId);
      setChannelLimit(data.channelLimit);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActive = useCallback(
    async (channelId: string) => {
      const previous = activeChannelId;
      setActiveChannelId(channelId);
      setChannels((cs) =>
        cs.map((c) => ({ ...c, isActive: c.id === channelId })),
      );
      try {
        const res = await fetch("/api/profile/active-channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId }),
        });
        if (!res.ok) throw new Error("Failed to set active channel");
      } catch {
        setActiveChannelId(previous);
        setChannels((cs) =>
          cs.map((c) => ({ ...c, isActive: c.id === previous })),
        );
      }
    },
    [activeChannelId],
  );

  return (
    <ChannelContext.Provider
      value={{
        channels,
        activeChannelId,
        channelLimit,
        loading,
        refresh,
        setActive,
      }}
    >
      {children}
    </ChannelContext.Provider>
  );
}
