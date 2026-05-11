import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;
type LoginAttemptInsert =
  Database["public"]["Tables"]["login_attempts"]["Insert"];
type LoginAttemptRow = Database["public"]["Tables"]["login_attempts"]["Row"];

export async function recordLoginAttempt(
  serviceClient: Client,
  attempt: LoginAttemptInsert,
): Promise<void> {
  const { error } = await serviceClient
    .from("login_attempts")
    .insert(attempt);

  if (error) throw error;
}

export async function recentSendsForEmail(
  serviceClient: Client,
  email: string,
  sinceMinutes: number,
): Promise<LoginAttemptRow[]> {
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  const { data, error } = await serviceClient
    .from("login_attempts")
    .select("*")
    .eq("email", email)
    .eq("outcome", "sent")
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
