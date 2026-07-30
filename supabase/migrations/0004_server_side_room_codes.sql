-- ─────────────────────────────────────────────────────────────────────────
-- 0004 · Close the room-code existence oracle.
--
-- (0002 and 0003 are the Realtime policy steps. They live in supabase/manual/
-- because they need owner-level execution and must never run through the
-- migration runner. This is the next runner-applicable migration after 0001.)
--
-- THE PROBLEM. `create_plan_room(p_code text)` took the code from its caller
-- and leaned on the unique constraint to reject duplicates. That made the
-- error an ORACLE: any signed-in account could ask "does room ABC234 exist?"
-- and read the answer off the `23505`, at unlimited rate, entirely bypassing
-- the 20-attempts-per-10-minutes throttle on `join_plan_room`. The throttle is
-- the stated enumeration perimeter and there was a door beside it.
--
-- THE FIX. The server mints the code. A collision is retried internally and is
-- never visible to the caller, who learns nothing about which codes exist.
-- Exhaustion raises a generic error that names no code.
--
-- WHY THE PARAMETER SURVIVES. The deployed client passes a code today.
-- Removing the parameter outright would break every in-flight session between
-- this migration and the next deploy — the same ordering trap as 0003. So
-- `p_code` stays, DEFAULTED and IGNORED. That keeps the old caller working and
-- lets the new client call `create_plan_room()` with no argument at all.
--
-- One function with a defaulted parameter, deliberately NOT two overloads:
-- PostgREST resolves overloads by matching payload keys, so `create_plan_room()`
-- and `create_plan_room(text)` side by side would make routing depend on a
-- subtlety nobody should have to think about during a cutover. A single
-- signature cannot be ambiguous.
--
-- HOW TO KNOW WHEN THE PARAMETER CAN GO. Not `pg_stat_user_functions` — with a
-- single signature there is one OID, so it counts calls but cannot tell a
-- caller that sent `p_code` from one that did not. Instead the body emits a
-- server-side `raise log` whenever a caller still sends a value. Drop the
-- parameter once those log lines stop (one deploy cycle should do it).
--
-- ROLLBACK. `create or replace` alone does NOT work here: Postgres refuses to
-- remove a parameter default from an existing function
-- ("cannot remove parameter defaults from existing function"). The parameter
-- gained a default in this migration, so reverting needs a drop first:
--
--   drop function public.create_plan_room(text);
--   -- then re-run 0001's create_plan_room body AND its grants:
--   --   revoke all on function public.create_plan_room(text) from public, anon, authenticated;
--   --   grant execute on function public.create_plan_room(text) to authenticated;
--   drop function public.new_plan_room_code();
--
-- Forward application is unaffected. This migration adds one function and
-- replaces one; it drops nothing and touches no table, policy or grant outside
-- the room set.
-- ─────────────────────────────────────────────────────────────────────────

-- 🧨 PRECONDITION. plpgsql resolves function calls at RUN time, so without
-- this the migration would apply cleanly against a database lacking pgcrypto
-- and then fail on every single room creation. Fail here instead, loudly, at
-- apply time. (0001 only needs gen_random_uuid(), which is core since PG13 —
-- it does not prove pgcrypto is present.)
do $$
begin
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception
      'pgcrypto is not available as extensions.gen_random_bytes(int); run: create extension if not exists pgcrypto with schema extensions';
  end if;
end
$$;

-- Cryptographically-random code. NOT random() — these codes gate access to a
-- room, and a predictable PRNG would let someone else's room be guessed rather
-- than brute-forced. 256 is an exact multiple of 32, so the byte -> alphabet
-- mapping is unbiased.
create or replace function public.new_plan_room_code()
returns text
language plpgsql
volatile
-- SECURITY INVOKER (the default): this touches no table, so definer rights
-- would be surface for nothing. Inside create_plan_room — which IS definer —
-- the effective role is already the owner, so the call chain still works while
-- no client role can reach it directly.
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b        bytea  := extensions.gen_random_bytes(6);
  out_code text   := '';
  i        int;
begin
  for i in 0..5 loop
    out_code := out_code || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  return out_code;
end;
$$;

-- Internal only. It is called from inside SECURITY DEFINER functions, which
-- run as the owner, so no client role needs EXECUTE on it. Handing it to
-- `authenticated` would give an attacker a free code generator and, worse, a
-- way to sample the generator's distribution.
revoke all on function public.new_plan_room_code() from public, anon, authenticated;

create or replace function public.create_plan_room(p_code text default null)
returns public.plan_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_room public.plan_rooms;
  v_code text;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  -- p_code is accepted and IGNORED, on purpose. Honouring it would keep the
  -- oracle alive; rejecting it would break the deployed client mid-flight.
  -- `raise log` goes to the server log only, never to the client, and never
  -- carries the value — it exists solely to tell us when the last old caller
  -- has gone so the parameter can be dropped.
  if p_code is not null then
    raise log 'create_plan_room: caller still sends p_code (ignored)';
  end if;

  -- 8 attempts against a 32^6 (~1.07e9) space. With even a million live rooms
  -- the chance of eight consecutive collisions is far below the chance of the
  -- transaction failing for any other reason.
  for i in 1..8 loop
    v_code := public.new_plan_room_code();
    begin
      insert into public.plan_rooms (code, topic, host_user_id)
      values (v_code, 'plan-' || v_code, v_uid)
      returning * into v_room;

      insert into public.plan_room_members (room_id, user_id)
      values (v_room.id, v_uid);

      return v_room;
    exception when unique_violation then
      -- 🧨 Swallow it. Surfacing 23505 to the caller is precisely the oracle
      -- this migration exists to remove. Try another code.
      null;
    end;
  end loop;

  -- Generic, and deliberately code-free.
  raise exception 'could not create room' using errcode = '55000';
end;
$$;

revoke all on function public.create_plan_room(text) from public, anon, authenticated;
grant execute on function public.create_plan_room(text) to authenticated;

-- ── Retention: sweep the throttle ledger on the same schedule ────────────
--
-- plan_room_join_attempts is keyed by USER, not by room, so nothing cascades
-- it when a room is purged: a bare user id would sit there forever. The
-- throttle window is 10 minutes (0001), so a row older than the room-retention
-- window is long dead and deleting it cannot reset a live throttle.
--
-- This moves INTO the function on purpose. It previously lived in the calling
-- script as a JavaScript date, which meant the retention window was editable
-- in two places and the script performed a destructive write of its own. Now
-- every delete in this feature is inside one SECURITY DEFINER function that
-- refuses any caller but the service role, and the script writes nothing.
create or replace function public.purge_expired_plan_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  delete from public.plan_rooms
   where expires_at < now() - interval '7 days';
  get diagnostics v_n = row_count;

  -- Same window, one place to change it.
  delete from public.plan_room_join_attempts
   where window_start < now() - interval '7 days';

  return v_n;
end;
$$;

revoke all on function public.purge_expired_plan_rooms() from public, anon, authenticated;
grant execute on function public.purge_expired_plan_rooms() to service_role;
