import { redirect } from "next/navigation";
import Link from "next/link";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";
import { getChannel, listChannels } from "@/lib/db/channels";

import { IdeaForm } from "./IdeaForm";

export default async function NewRunPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const profile = await getProfile(supabase, user.id);
  if (!profile?.active_channel_id) {
    const channels = await listChannels(supabase, user.id);
    if (channels.length === 0) redirect("/onboard");
    redirect("/onboard");
  }

  const active = await getChannel(supabase, profile.active_channel_id);
  if (!active) redirect("/onboard");

  const competitorCount = active.competitorSet.length;
  const subsLabel =
    active.subscriber_count !== null
      ? `${active.subscriber_count.toLocaleString()} subs`
      : "subs hidden";

  return (
    <div className="px-6 py-10 max-w-2xl mx-auto">
      <nav className="text-xs text-ink-400 mb-3">
        <Link href="/runs" className="hover:text-ink-200 transition">
          Runs
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-300">New idea</span>
      </nav>
      <h1 className="text-3xl font-extrabold tracking-tight text-white">
        Drop a video idea
      </h1>
      <p className="text-sm text-ink-300 mt-2">
        We&apos;ll spin up the 12-stage pipeline against your channel context
        and stream results live.
      </p>

      <section className="card rounded-2xl p-4 mt-6 flex items-center gap-3">
        <span className="h-10 w-10 rounded-xl bg-gradient-to-br from-yt-500 to-orange-500 flex items-center justify-center text-white text-base font-extrabold shrink-0">
          {active.title.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">
              {active.title}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yt-600/15 text-yt-400 text-[10px] font-bold uppercase tracking-wider">
              active channel
            </span>
          </div>
          <p className="text-xs text-ink-400 mt-0.5 truncate">
            {active.niche ?? "Niche pending"} · {subsLabel} ·{" "}
            {competitorCount} competitor{competitorCount === 1 ? "" : "s"}{" "}
            tracked
          </p>
        </div>
        <Link
          href="/onboard"
          className="text-xs text-ink-400 hover:text-ink-200 transition"
        >
          Switch
        </Link>
      </section>

      <div className="mt-6">
        <IdeaForm />
      </div>
    </div>
  );
}
