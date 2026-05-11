export default function Home() {
  return (
    <main className="glow-bg min-h-screen flex flex-col items-center justify-center p-8">
      <div className="card max-w-2xl w-full p-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yt-600/15 text-yt-400 text-xs font-medium mb-5">
          <span className="size-1.5 rounded-full bg-yt-500 pulse-dot" />
          Phase 1.1 — scaffold ready
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight mb-3">
          YouTube Viralizer
        </h1>
        <p className="text-ink-300 text-lg mb-8">
          Turn one video idea into a 12-stage viral production kit.
        </p>
        <div className="flex gap-3 justify-center">
          <span
            className="size-8 rounded bg-yt-500"
            title="yt-500 — brand red"
          />
          <span
            className="size-8 rounded bg-ink-900 ring-1 ring-white/10"
            title="ink-900 — surface"
          />
          <span
            className="size-8 rounded bg-curiosity-500"
            title="curiosity-500 — trigger"
          />
          <span
            className="size-8 rounded bg-fear-500"
            title="fear-500 — trigger"
          />
          <span
            className="size-8 rounded bg-result-500"
            title="result-500 — trigger"
          />
        </div>
      </div>
    </main>
  );
}
