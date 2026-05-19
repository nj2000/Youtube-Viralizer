import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRun } from "@/lib/db/runs";

import { RunView } from "./RunView";

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const run = await getRun(supabase, runId);
  if (!run || run.userId !== user.id) redirect("/runs");

  return (
    <div className="px-6 py-10 max-w-3xl mx-auto">
      <RunView initialRun={run} />
    </div>
  );
}
