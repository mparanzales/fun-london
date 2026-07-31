-- ─────────────────────────────────────────────────────────────────────────
-- 0005 — a DB-side throttle on room CREATION, and the end of p_code.
--
-- 🧨 WHAT WAS WRONG. `create_plan_room` is granted EXECUTE to `authenticated`,
-- so it is reachable directly at /rest/v1/rpc/create_plan_room. The only limit
-- on it was the Upstash counter in lib/room-action.ts (10/hour), which a caller
-- hitting PostgREST skips entirely. 0001 already makes this exact argument for
-- the JOIN path:
--
--     "Throttle: 20 attempts per 10 minutes per account, enforced HERE so it
--      cannot be skipped by calling the RPC directly… an app-layer limit on a
--      granted function is decorative."
--
-- Join got that treatment. Create never did. This closes the asymmetry.
--
-- It is not a data leak and not a privilege escalation: it is row-spam by an
-- authenticated account, bounded by the nightly purge to roughly seven days.
-- The reason to fix it is that two sibling RPCs had two different security
-- postures for no stated reason, which is how the weaker one gets copied.
--
-- WINDOW: 10 per hour, deliberately NOT the join window (20 per 10 min).
-- A create writes two rows and mints a code; a failed join reads one row. They
-- are not the same cost and should not share a budget. 10/hour is the same
-- number the Upstash counter uses and the same number the user-facing copy
-- describes ("You've started several in the last hour" — lib/room-errors.ts).
--
-- ⚠️ THE TWO WINDOWS ARE NOT THE SAME SHAPE, and an earlier draft of this
-- comment claimed they "agree". They do not: lib/rate-limit.ts uses
-- `Ratelimit.slidingWindow`, this is a FIXED window. A fixed window permits a
-- boundary burst — 10 creates at T+59:50 and 10 more at T+60:10 is 20 rooms in
-- twenty seconds — so the DB limit is the LOOSER of the two, and the
-- direct-PostgREST caller (the entire population this exists to bound) only
-- ever meets the loose one. That is still a hard ceiling of ~20/hour against
-- the unbounded situation before, and a fixed window is what the join throttle
-- already uses, so this keeps one pattern rather than two. Recorded because a
-- future reader should not have to rediscover it, and because it is the number
-- to tighten first if room-spam ever actually happens.
--
-- The Upstash limit STAYS. It is cheaper, it never touches Postgres, it is the
-- stricter of the two for anyone using the app normally, and it returns a
-- clean reason. This is the floor underneath it, not a replacement.
--
-- ── The p_code parameter goes ──────────────────────────────────────────
--
-- 0004 kept `p_code text default null`, accepted-and-ignored, so a deployed
-- client mid-rollout would not break, and logged `raise log` when one still
-- sent it. That log was the ONLY signal for when the parameter could go, and
-- nobody watches Postgres logs.
--
-- Checked before removing it, three ways:
--   • lib/room-action.ts is "use server" — the RPC is only ever called from the
--     server, so no stale browser can send it. After a deploy settles there is
--     no old caller by construction.
--   • the one call site passes no arguments: `.rpc("create_plan_room")`.
--   • scripts/__tests__/room-hygiene.test.ts already FAILS if a second
--     argument reappears.
--   • the staging suite's four calls all pass none either.
--
-- (The `raise log` fired once on 2026-07-30, 45 seconds after two
-- `permission denied` errors and a minute after 0004 was applied over MCP —
-- i.e. someone verifying by hand. An earlier draft credited it to
-- staging-room-security-suite.ts, which is wrong: that suite refuses to run
-- against the production ref at all. The three reasons above carry the
-- decision on their own; the log is not evidence either way.)
--
-- 🧨 THE OLD SIGNATURE IS DROPPED BEFORE THE NEW ONE IS CREATED, and the order
-- is the opposite of what it looks like it should be. `create or replace
-- function create_plan_room()` does NOT replace `create_plan_room(p_code text
-- default null)` — Postgres identifies a function by (name, argument types),
-- so the zero-arg version is a NEW object and both would exist at once.
--
-- With both present a no-argument call is AMBIGUOUS. Verified against
-- Postgres 17.10 rather than assumed:
--
--     select public.create_plan_room()
--     ERROR 42725: function public.create_plan_room() is not unique
--
-- PostgREST surfaces that as HTTP 300 / PGRST203, which lib/room-action.ts has
-- no branch for: it falls to reason "error", then to failureFromJoin's default
-- "denied", and the user is told "You're not in this room" about a room they
-- were trying to START. 0004's header already said one signature, never two.
--
-- Inside a transaction nobody observes the intermediate state either way. The
-- order matters if this file is ever applied in halves, and then the two
-- failure modes are not equal: drop-first leaves NO function and fails loudly
-- (PGRST202, "could not find the function"), which is diagnosable in seconds.
-- Drop-last leaves TWO and fails ambiguously, which looks like a generic app
-- error and sends someone hunting in the wrong layer.
--
-- Apply this file as ONE transaction. If you cannot, drop-first is the half
-- you want to have run.
--
-- ── Rollback ──────────────────────────────────────────────────────────
--
--   drop function if exists public.create_plan_room();
--   drop table if exists public.plan_room_create_attempts;
--   -- then restore 0004's create_plan_room(text) and its purge body verbatim
--   -- AND, on the same pass, re-run 0004's grants:
--   revoke all on function public.create_plan_room(text) from public, anon, authenticated;
--   grant execute on function public.create_plan_room(text) to authenticated;
--
-- 🧨 THOSE TWO LINES ARE NOT OPTIONAL. Restoring 0004's body creates a NEW
-- function OID, and Postgres grants EXECUTE to PUBLIC on every new function by
-- default -- anon and authenticated are both members of PUBLIC. A rollback
-- that stops at "restore the body" leaves create_plan_room executable by
-- signed-out callers, and nothing surfaces it unless someone separately runs
-- verify-room-security.ts. 0004's own rollback note spells the grants out for
-- this reason; an earlier draft of this one did not.
--
-- Dropping the TABLE is likewise not optional: plan_room_create_attempts holds
-- bare auth user ids, so leaving it behind leaves personal data behind. That
-- is the fourth such table in this track (see 0001's header).
--
-- Additive apart from the deliberate signature swap: it adds one table, adds
-- one function, replaces one, and touches no policy or grant outside the room
-- set.
-- ─────────────────────────────────────────────────────────────────────────

-- Create-attempt throttle. Server-side for the reason 0001 states about join:
-- the RPC is reachable directly over PostgREST, so an app-layer limit on a
-- granted function is decorative.
--
-- Separate table from plan_room_join_attempts on purpose. Sharing one would
-- make a burst of failed joins eat the create budget and vice versa, which
-- couples two limits that exist for different reasons.
create table if not exists public.plan_room_create_attempts (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts     integer     not null default 0,
  primary key (user_id)
);
alter table public.plan_room_create_attempts enable row level security;
revoke all on public.plan_room_create_attempts from public, anon, authenticated;

-- 🧨 DROPPED FIRST. See the header: `create or replace ...()` would NOT
-- replace `...(p_code text default null)`, it would ADD a second signature,
-- and a no-argument call against both is ambiguous (42725 in Postgres, HTTP
-- 300 from PostgREST). Dropping first makes that state unreachable.
drop function if exists public.create_plan_room(text);

-- The function, minus p_code, plus the throttle.
create or replace function public.create_plan_room()
returns public.plan_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_room public.plan_rooms;
  v_code text;
  v_attempts int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  -- 🧨 THE THROTTLE, and it must come BEFORE any insert.
  --
  -- On the rollback semantics, which look wrong and are not: raising below
  -- rolls this increment back with the rest of the transaction, so the counter
  -- sticks at the limit rather than climbing. That is the same behaviour
  -- 0001's join throttle has, and it is correct — every further attempt
  -- re-increments to limit+1 and re-raises, and `window_start` keeps its
  -- ORIGINAL value, so the window expires an hour after the first attempt
  -- rather than being pushed forward by the attacker's own hammering.
  insert into public.plan_room_create_attempts (user_id, window_start, attempts)
  values (v_uid, now(), 1)
  on conflict (user_id) do update
    set attempts = case
          when public.plan_room_create_attempts.window_start < now() - interval '1 hour'
          then 1 else public.plan_room_create_attempts.attempts + 1 end,
        window_start = case
          when public.plan_room_create_attempts.window_start < now() - interval '1 hour'
          then now() else public.plan_room_create_attempts.window_start end
  returning attempts into v_attempts;

  -- 🧨 FAIL CLOSED, and `is null` is not defensive noise. Written as a second
  -- `select ... where user_id = v_uid`, a NULL result makes `NULL > 10` NULL,
  -- the `if` does not fire, and the throttle silently ceases to exist. It is
  -- unreachable today because the upsert guarantees the row -- which is
  -- exactly what was said about the empty-string CI secret and about 0004's
  -- current_user check. RETURNING also removes the second index probe.
  if v_attempts is null or v_attempts > 10 then
    -- 53400 = configuration_limit_exceeded. The SAME code the join throttle
    -- raises, so lib/room-action.ts has one thing to recognise; the CALLER
    -- decides whether that means "too many rooms" or "too many guesses".
    raise exception 'too many room creations' using errcode = '53400';
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
      -- 0004 exists to remove. Try another code.
      null;
    end;
  end loop;

  -- Generic, and deliberately code-free.
  raise exception 'could not create room' using errcode = '55000';
end;
$$;

revoke all on function public.create_plan_room() from public, anon, authenticated;
grant execute on function public.create_plan_room() to authenticated;

-- The purge must sweep the new table too.
--
-- 🧨 WITHOUT THIS, bare user ids accumulate forever. 0004 added exactly this
-- for plan_room_join_attempts and gave the reason: nothing else deletes them,
-- because they are keyed by USER and not by room, so no room deletion
-- cascades. The create window is 1 hour, so a row older than the 7-day
-- retention is long dead and removing it cannot reset a live throttle.
create or replace function public.purge_expired_plan_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  delete from public.plan_rooms
   where expires_at < now() - interval '7 days';
  get diagnostics v_n = row_count;

  delete from public.plan_room_join_attempts
   where window_start < now() - interval '7 days';

  delete from public.plan_room_create_attempts
   where window_start < now() - interval '7 days';

  return v_n;
end;
$$;

revoke all on function public.purge_expired_plan_rooms() from public, anon, authenticated;
grant execute on function public.purge_expired_plan_rooms() to service_role;
