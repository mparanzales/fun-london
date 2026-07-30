-- ⚠️ OWNER-LEVEL EXECUTION REQUIRED — THIS FILE CANNOT BE APPLIED BY THE
-- NORMAL MIGRATION PATH.
--
-- Measured against the live project 2026-07-29:
--   current_user                                   = postgres
--   rolsuper(postgres)                             = FALSE
--   owner of realtime.messages                     = supabase_realtime_admin
--   pg_has_role(postgres, supabase_realtime_admin) = FALSE
--   postgres is a member of                        = supabase_privileged_role
--
-- ✅ AND YET THE PROBE BELOW SUCCEEDS. It was RUN against production through
-- the Supabase MCP `execute_sql` path: the policy was created, confirmed in
-- pg_policies, then dropped, leaving production at exactly its two original
-- policies. An earlier revision of this header concluded from the pg_has_role
-- result that no route existed. The measurement was right; the inference was
-- wrong. `supabase_privileged_role` is the likely mechanism, but stock
-- PostgreSQL semantics do not fully explain it — so trust the PROBE, not the
-- theory. Run it, watch it succeed, then proceed. If it ever 42501s, STOP.
--
-- STILL TRUE: `supabase db push`, `db reset`, `apply_migration` and CI take a
-- different path and must not be relied on for this file.
--
-- WHY THIS FILE IS NOT IN supabase/migrations/: it cannot be applied by the
-- migration runner, so leaving it in the numbered chain would abort any
-- `supabase db push` / `db reset` (including the bootstrap of a fresh staging
-- project) partway through. Same precedent as supabase/realtime-policies.sql.
--
-- APPLY VIA (route CONFIRMED 2026-07-29, but re-prove it every time): a
-- privileged SQL session — the Supabase MCP `execute_sql` path, or the
-- dashboard SQL editor. Immediately before the production window, re-run this
-- inert ownership probe:
--     create policy "zz_probe_delete_me" on realtime.messages
--       for select to authenticated using (false);
--     drop policy "zz_probe_delete_me" on realtime.messages;
--   A `using (false)` permissive policy grants nothing and removes nothing, so
--   it is the safest possible ownership test. Confirm it appears in pg_policies
--   and that the DROP leaves exactly the policies you started with. If it
--   42501s, STOP — the plan then needs a different owner-level mechanism (e.g.
--   Supabase support granting supabase_realtime_admin to postgres for one
--   window, then revoking).
--
-- Then paste the statements below verbatim and prove the result.
--
-- ⚠️ `EXPECT_STAGE=2 pnpm verify-room-security` works against a database that
-- has the exec_sql_readonly RPC. Production deliberately does NOT — that helper
-- was REJECTED as unsafe (see
-- docs/funldn-group-security-staging-evidence/REJECTED-exec_sql_readonly.sql).
-- Against production, run the catalog queries from scripts/verify-room-security.ts
-- §1-3 over the same privileged session and paste the output into
-- docs/FUNLDN_GROUP_SECURITY_PRODUCTION_ROLLOUT.md.
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
