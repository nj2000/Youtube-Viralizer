import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countActiveChannels } from "@/lib/db/channels";

import { OnboardForm } from "./OnboardForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const errorCode = firstParam(params.error);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const channelCount = await countActiveChannels(supabase, user.id);
  if (channelCount >= 3) {
    redirect("/runs?toast=channel-limit");
  }

  return (
    <div className="glow-bg min-h-[calc(100vh-64px)] px-6 py-16">
      <div className="max-w-xl mx-auto">
        <OnboardForm initialError={errorCode ?? null} />
      </div>
    </div>
  );
}
