-- Phase 1.2 / 0004 — auto-create profiles on new auth.users
-- security definer lets the trigger write to public.profiles regardless of the
-- authenticated session's RLS context (a new auth user has no session yet).
-- Function lives in `private` schema so it isn't reachable via the Data API.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, channel_count_cache)
    values (new.id, 0)
    on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
