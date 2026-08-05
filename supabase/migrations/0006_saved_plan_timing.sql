-- 0006: saved nights carry their timing, and can be UPDATED in place.
--
-- WHY. `plans` stored four keys per stop and nothing about WHEN, so a
-- reopened night had no clock (no arrivals, no opening-hours checks), and the
-- write path was insert-only — every re-save of an edited night was a
-- duplicate row in a table with no delete UI. This adds nullable timing plus
-- a self-scoped UPDATE policy so an edited night saves back to its own row.
--
-- Additive and idempotent. Existing rows keep working: timing columns are
-- NULL (the app treats that exactly as it treats them today), and updated_at
-- is backfilled to created_at rather than to the migration's own timestamp,
-- so "last touched" stays honest for old rows.

-- Apply as ONE transaction (house rule, 0005). The default is set BEFORE the
-- backfill so no insert can land a NULL in the window between them.
--
-- Rollback: drop policy if exists "plans self update" on public.plans;
--           drop trigger if exists plans_pin_row on public.plans;
--           alter table public.plans alter column updated_at drop not null,
--             alter column updated_at drop default;
-- DESTRUCTIVE beyond this line - drops user timing data, unrecoverable:
--           -- alter table public.plans drop column starts_at,
--           --   drop column ends_at, drop column updated_at;
begin;

alter table public.plans
  add column if not exists starts_at  timestamptz,
  add column if not exists ends_at    timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.plans alter column updated_at set default now();
update public.plans set updated_at = created_at where updated_at is null;
alter table public.plans alter column updated_at set not null;

-- The UPDATE policy mirrors the existing self read/write/delete trio: a user
-- may update only their own rows, and cannot re-home a row to another user
-- (WITH CHECK pins user_id on the new tuple too).
drop policy if exists "plans self update" on public.plans;
create policy "plans self update" on public.plans
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Two layers for anon, matching user_events: RLS already denies, and the
-- table privilege goes too, since 0006 is what first makes UPDATE meaningful.
revoke all on public.plans from anon;
-- 🧨 The policy is meaningless without the table privilege: live verification
-- showed authenticated lacked UPDATE (the table carries explicit grants, not
-- Supabase defaults), so every policy-permitted update failed 42501 before
-- RLS was even consulted. The trigger above pins row identity.
grant update on public.plans to authenticated;

-- updated_at is SERVER-authoritative, and row identity is pinned in the
-- database rather than in the client's good manners: enabling UPDATE made
-- created_at client-writable for the first time, and a client clock on a
-- granted table is decorative the moment anything reads it.
create or replace function public.plans_pin_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists plans_pin_row on public.plans;
create trigger plans_pin_row before update on public.plans
  for each row execute function public.plans_pin_row();

commit;
