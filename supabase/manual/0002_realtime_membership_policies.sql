-- ⚠️ OWNER-LEVEL EXECUTION REQUIRED — THIS FILE CANNOT BE APPLIED BY THE
-- NORMAL MIGRATION PATH.
--
-- Verified against the live project 2026-07-29 (read-only):
--   current_user                                  = postgres
--   owner of realtime.messages                    = supabase_realtime_admin
--   pg_has_role(postgres, supabase_realtime_admin) = FALSE
--
-- CREATE POLICY / DROP POLICY require table ownership, so `supabase db push`,
-- the MCP apply_migration tool and any CI migration step will fail here with
--   ERROR: 42501: must be owner of table messages
-- This is the same constraint recorded in supabase/realtime-policies.sql: the
-- live broad policies were created through the Supabase dashboard, not a
-- migration.
--
-- WHY THIS FILE IS NOT IN supabase/migrations/: it cannot be applied by the
-- migration runner, so leaving it in the numbered chain would abort any
-- `supabase db push` / `db reset` (including the bootstrap of a fresh staging
-- project) partway through. Same precedent as supabase/realtime-policies.sql.
--
-- APPLY VIA (⚠️ UNVERIFIED REMEDY — prove it first): the Supabase dashboard SQL
-- editor is the mechanism that created the current live policies, but that is
-- project history, not a measurement of what that session can do today. Before
-- the production window, run this inert ownership probe in the SQL editor:
--     create policy "zz_probe_delete_me" on realtime.messages
--       for select to authenticated using (false);
--     drop policy "zz_probe_delete_me" on realtime.messages;
--   A `using (false)` permissive policy grants nothing and removes nothing, so
--   it is the safest possible ownership test. If it 42501s, STOP — the whole
--   plan needs a different owner-level mechanism (e.g. Supabase support
--   granting supabase_realtime_admin to postgres for one window, then revoking).
--
-- Then paste the statements below verbatim and prove the result:
--   EXPECT_STAGE=2 pnpm verify-room-security
-- The repository copy and the applied database state must stay identical; the
-- verification script is what proves they are.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 0002 · Membership-scoped Realtime policies (DUAL-RUN step).
--
-- STEP 2 OF 3. Adds the narrow policies ALONGSIDE the existing broad
-- plan-% ones. Postgres OR's permissive policies together, so this file
-- CANNOT break a live room: anyone the old policy allowed is still allowed.
-- Its purpose is to get the new predicate running in production so it can be
-- verified against real traffic before anything is taken away.
--
-- Apply only AFTER 0001 and after the client that creates/joins membership
-- records is deployed — otherwise the new predicate has no rows to match and
-- verification would (correctly) report zero members.
--
-- Verify before running 0003:
--   pnpm tsx scripts/verify-room-security.ts
-- ─────────────────────────────────────────────────────────────────────────

-- Note: do NOT `alter table realtime.messages enable row level security` —
-- Supabase already did, and the table is owned by supabase_realtime_admin,
-- so the statement fails with 42501 (documented in supabase/realtime-policies.sql).

create policy "plan room members read"
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) like 'plan-%'
    and extension in ('broadcast', 'presence')
    and public.is_plan_room_member((select realtime.topic()))
  );

create policy "plan room members write"
  on realtime.messages
  for insert
  to authenticated
  with check (
    (select realtime.topic()) like 'plan-%'
    and extension in ('broadcast', 'presence')
    and public.is_plan_room_member((select realtime.topic()))
  );
