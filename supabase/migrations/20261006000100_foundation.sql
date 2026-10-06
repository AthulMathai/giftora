-- Giftora foundation: extensions, the internal schema, shared helpers.
--
-- The single most important rule in this codebase:
--   Customer-facing data lives in `public` (exposed through the Supabase API, guarded by RLS).
--   Supplier, cost, profit, reservation and fulfillment data lives in `internal`,
--   which the API never exposes and which anon/authenticated roles cannot touch at all.

-- Supabase keeps extensions in their own schema; do the same so types resolve identically
-- everywhere. gen_random_uuid() is built into Postgres, so pgcrypto isn't needed.
create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists internal;

-- Lock the internal schema down completely for client roles.
revoke all on schema internal from public;
revoke all on schema internal from anon, authenticated;
grant usage on schema internal to service_role;
alter default privileges in schema internal revoke all on tables from public, anon, authenticated;
alter default privileges in schema internal revoke all on functions from public, anon, authenticated;
alter default privileges in schema internal revoke all on sequences from public, anon, authenticated;
alter default privileges in schema internal grant all on tables to service_role;
alter default privileges in schema internal grant all on functions to service_role;
alter default privileges in schema internal grant all on sequences to service_role;

-- Functions in public are executable by everyone by default; we opt in per function instead.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- updated_at maintenance
create or replace function internal.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Money is always integer cents. This domain documents intent and blocks negatives.
create domain public.money_cents as bigint check (value >= 0);
