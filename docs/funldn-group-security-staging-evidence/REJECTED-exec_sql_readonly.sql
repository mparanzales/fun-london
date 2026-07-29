-- ❌ REJECTED — DO NOT CREATE THIS IN PRODUCTION. Kept only so nobody revives
-- it in six months on the strength of its confident-sounding rationale below.
--
-- Rejected 2026-07-29 by supabase-guardian, with a counter-example against our
-- own schema. The rationale below claims that wrapping the statement in a
-- scalar subquery means "nothing but a SELECT is grammatically valid in that
-- position, so no DDL/DML can be smuggled in". That is FALSE as a safety
-- property:
--
--     select public.purge_expired_plan_rooms()
--
-- It starts with `select`. It contains no `;`. It is valid in the subquery
-- position. It passes both filters. And it DELETES rows — because a SELECT of
-- a volatile function is a side effect. Worse, the function is SECURITY
-- DEFINER owned by postgres, so `current_user` inside the call chain is
-- postgres, which satisfies purge_expired_plan_rooms's own guard.
--
-- Generalised, this object is a permanent primitive that invokes ANY security
-- definer function in the database as postgres and reads any table regardless
-- of RLS. Creating it in order to verify that we had closed a Realtime hole
-- would have opened a strictly larger one, and would escalate a leaked
-- service-role key from "read everything" to "execute anything".
--
-- WHAT WE DO INSTEAD: production policy state is verified with direct catalog
-- queries over a privileged SQL session, and the output is pasted into the
-- rollout document. No standing attack surface.
--
-- The durable fix for the verification scripts is to open a direct Postgres
-- connection rather than an RPC — that also repairs verify-plan.ts and
-- verify-feed-rank.ts by the same route. Tracked as follow-up.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ORIGINAL (REJECTED) DEFINITION AND ITS FLAWED RATIONALE FOLLOW.
-- ─────────────────────────────────────────────────────────────────────────

-- PRODUCTION PREREQUISITE — not yet applied anywhere hosted.
--
-- scripts/verify-room-security.ts calls this RPC; without it every automated
-- gate in the production sequence aborts (it fails closed, but it does not
-- run). This definition was exercised on the local stack during the staging
-- verification, 2026-07-29.
--
-- scripts/verify-room-security.ts needs to read pg_policies / pg_proc, and
-- PostgREST cannot select from pg_catalog. This is the missing prerequisite
-- the review flagged. A generic "run SQL" RPC is a real attack surface, so it
-- is constrained three ways:
--
--   1. EXECUTE is revoked from public, anon and authenticated. Only
--      service_role may call it, and the service key never reaches a browser.
--   2. The statement is wrapped in a scalar subquery. Nothing but a SELECT is
--      grammatically valid in that position, so no DDL/DML can be smuggled in
--      and a second statement cannot be appended.
--   3. It is rejected unless it begins with `select` and contains no statement
--      separator, which stops the obvious games before parsing.
--
-- Returns jsonb so PostgREST hands the caller a plain array of row objects.

create or replace function public.exec_sql_readonly(q text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  out_json jsonb;
  trimmed text := btrim(q, E' \t\r\n;');
begin
  if trimmed !~* '^select\s' then
    raise exception 'exec_sql_readonly: only SELECT is permitted';
  end if;
  if position(';' in trimmed) > 0 then
    raise exception 'exec_sql_readonly: statement separators are not permitted';
  end if;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(sub)), ''[]''::jsonb) from (%s) as sub',
    trimmed
  ) into out_json;

  return out_json;
end;
$$;

revoke all on function public.exec_sql_readonly(text) from public, anon, authenticated;
grant execute on function public.exec_sql_readonly(text) to service_role;
