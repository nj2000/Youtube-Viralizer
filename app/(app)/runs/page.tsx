import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";
import { listChannels } from "@/lib/db/channels";

import { RunsList } from "./RunsList";

export default async function RunsPage() {
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

  const channels = await listChannels(supabase, user.id);
  const active = channels.find((c) => c.id === profile.active_channel_id);

  return (
    <div className="px-6 py-10 max-w-5xl mx-auto">
      <RunsList channelTitle={active?.title ?? "Your channel"} />
    </div>
  );
}
