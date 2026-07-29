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
