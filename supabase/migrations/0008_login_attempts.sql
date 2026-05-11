-- Phase 1.2 / 0008 — login_attempts (rate-limit audit, service-role only)
-- Indexed for the hot path: "how many 'sent' attempts for this email recently?"
-- 90-day retention (cleanup cron in Phase 2).

create table public.login_attempts (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null,
  ip_address    inet,
  user_agent    text,
  outcome       text not null check (outcome in (
    'sent',
    'rate_limited',
    'invalid_email',
    'send_failed',
    'callback_success',
    'callback_expired',
    'callback_already_used',
    'callback_invalid'
  )),
  attempted_at  timestamptz not null default now(),
  user_id       uuid references auth.users(id) on delete set null
);

create index login_attempts_email_sent_recent_idx
  on public.login_attempts (email, attempted_at desc)
  where outcome = 'sent';

create index login_attempts_user_idx
  on public.login_attempts (user_id, attempted_at desc)
  where user_id is not null;

create index login_attempts_attempted_at_idx
  on public.login_attempts (attempted_at);

alter table public.login_attempts enable row level security;
-- No policies → service-role only.
