import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getOnboardDraft } from "@/lib/db/onboard-drafts";
import { ChannelDraftSchema } from "@/lib/validation/onboard";

import { ReviewClient } from "./ReviewClient";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OnboardReviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const draftId = firstParam(params.draftId);
  if (!draftId) redirect("/onboard");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const serviceClient = createSupabaseServiceClient();
  const draftRow = await getOnboardDraft(serviceClient, draftId);
  if (!draftRow || draftRow.user_id !== user.id) redirect("/onboard");

  const parsed = ChannelDraftSchema.safeParse({
    draftId: draftRow.draft_id,
    ...(draftRow.payload as Record<string, unknown>),
  });
  if (!parsed.success) redirect("/onboard");

  return (
    <div className="glow-bg min-h-[calc(100vh-64px)] px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <ReviewClient draft={parsed.data} />
      </div>
    </div>
  );
}
