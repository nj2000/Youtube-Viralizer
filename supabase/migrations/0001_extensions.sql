-- Phase 1.2 / 0001 — Postgres extensions + private schema
-- citext: case-insensitive email column on login_attempts.
-- pg_trgm: trigram GIN index on pipeline_runs.idea_text for ILIKE substring search.
-- private schema: holds security-definer functions so they aren't reachable
--   via the Data API (which exposes the public schema).

create extension if not exists citext;
create extension if not exists pg_trgm;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
