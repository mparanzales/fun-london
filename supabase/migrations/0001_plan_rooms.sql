-- ─────────────────────────────────────────────────────────────────────────
-- 0001 · Plan Together rooms: persistent room + membership records.
--
-- STEP 1 OF 3. Purely ADDITIVE: creates two new tables, their RLS, and the
-- membership predicate used later by the Realtime policies. It changes NO
-- existing policy and NO existing table, so it is safe to apply while the
-- current (broad) realtime.messages policies are still live — rooms keep
-- working exactly as they do today.
--
-- Sequence:
--   0001 (this file)  tables + membership function      ← no behaviour change
--   0002              ADD membership-scoped realtime policies (dual-run;
--                     the old broad ones still OR in, so nothing breaks)
--   0003              DROP the broad plan-% policies    ← only after verify
--
-- Rollback for this file: drop the THREE tables (plan_rooms,
-- plan_room_members, plan_room_join_attempts — the last one holds user ids, so
-- leaving it behind is a data-retention miss) and the NINE functions (see
-- docs/FUNLDN_GROUP_SECURITY_IMPLEMENTATION.md § Rollback). Nothing else in
-- the product reads them until the client change ships.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.plan_rooms (
  id           uuid primary key default gen_random_uuid(),
  -- The 6-char join code (see lib/room-code.ts). Unique so a collision fails
  -- loudly at insert instead of silently merging two groups into one room.
  code         text        not null unique,
  -- The Realtime channel topic this room owns: 'plan-' || code. Stored (not
  -- derived at policy time) so the RLS predicate is an exact index lookup
  -- rather than a string manipulation on every message.
  topic        text        not null unique,
  host_user_id uuid        not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- ~6 hours (the product decision). Enforced in the policy predicate, so an
  -- expired room stops accepting traffic without any cron having to run.
  expires_at   timestamptz not null default now() + interval '6 hours',
  -- Host-controlled early closure. Non-null = closed.
  closed_at    timestamptz,
  -- Liveness for host handoff: the host's client refreshes this; when it goes
  -- stale the NEXT member in the roster ring is promoted, not simply the
  -- earliest-joined (see promote_plan_room_host for why that oscillated).
  host_seen_at timestamptz not null default now(),
  -- Pin the SHAPE, not just the length: create_plan_room takes the code from
  -- its caller, so without this a direct PostgREST call could mint a 4-char
  -- (enumerable) room and re-open the very hole this migration closes.
  constraint plan_rooms_code_fmt  check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  constraint plan_rooms_topic_fmt check (topic = 'plan-' || code)
);

create table if not exists public.plan_room_members (
  room_id   uuid        not null references public.plan_rooms (id) on delete cascade,
  -- AUTHORITATIVE member identity. The old model minted crypto.randomUUID()
  -- on the client, which meant a member id was whatever the client claimed.
  user_id   uuid        not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  primary key (room_id, user_id)
);

create index if not exists plan_rooms_expires_idx
  on public.plan_rooms (expires_at);
create index if not exists plan_rooms_host_idx
  on public.plan_rooms (host_user_id);
create index if not exists plan_room_members_user_idx
  on public.plan_room_members (user_id);
-- Host handoff reads the roster in join order.
create index if not exists plan_room_members_room_joined_idx
  on public.plan_room_members (room_id, joined_at);

alter table public.plan_rooms        enable row level security;
alter table public.plan_room_members enable row level security;

-- ── Membership predicate ────────────────────────────────────────────────
-- SECURITY DEFINER so the Realtime policy can read the roster without the
-- caller needing table-level rights, and so the policy on plan_room_members
-- can never recurse into itself. search_path is pinned (empty) and every
-- reference is schema-qualified — the standard hardening for definer
-- functions.
create or replace function public.is_plan_room_member(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plan_room_members m
    join public.plan_rooms r on r.id = m.room_id
    where r.topic = p_topic
      and m.user_id = (select auth.uid())
      and m.left_at is null
      and r.closed_at is null
      and r.expires_at > now()
  );
$$;

-- Membership WITHOUT the liveness conditions. The Realtime policies must use
-- the strict predicate (a closed room carries no traffic), but the TABLE read
-- policies must use this one: otherwise the moment a room closes or expires
-- its members can no longer select the row, the client sees "room vanished"
-- instead of "that room was closed", and the honest-failure copy never fires.
create or replace function public.is_plan_room_participant(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_room_members m
    where m.room_id = p_room_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_plan_room_member(text)  from public, anon, authenticated;
revoke all on function public.is_plan_room_participant(uuid) from public, anon, authenticated;
grant execute on function public.is_plan_room_member(text)   to authenticated;
grant execute on function public.is_plan_room_participant(uuid) to authenticated;

-- ── RLS on the new tables ───────────────────────────────────────────────
-- A member may read the room they belong to (needed for the roster, host id
-- and expiry). Writes go exclusively through SECURITY DEFINER functions
-- below, so there are deliberately NO insert/update policies for clients.
-- Idempotent like the rest of this file: a re-run (a fresh staging bootstrap, or
-- a `db push` after the objects were applied out-of-band) must not abort with
-- 42710. Every other statement here is `if not exists` / `or replace`.
drop policy if exists "plan_rooms member read" on public.plan_rooms;
create policy "plan_rooms member read"
  on public.plan_rooms
  for select
  to authenticated
  using (
    public.is_plan_room_participant(id) or host_user_id = (select auth.uid())
  );

drop policy if exists "plan_room_members member read" on public.plan_room_members;
create policy "plan_room_members member read"
  on public.plan_room_members
  for select
  to authenticated
  using (
    public.is_plan_room_participant(plan_room_members.room_id)
    or exists (
      select 1 from public.plan_rooms r
      where r.id = plan_room_members.room_id
        and r.host_user_id = (select auth.uid())
    )
  );

-- ── Write paths (all SECURITY DEFINER, all identity-from-session) ───────
-- Every function below derives the acting user from auth.uid(). No function
-- takes a user id as an argument, so a client cannot act as somebody else.

-- Create a room and enrol the creator as host + first member.
create or replace function public.create_plan_room(p_code text)
returns public.plan_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_room public.plan_rooms;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  insert into public.plan_rooms (code, topic, host_user_id)
  values (p_code, 'plan-' || p_code, v_uid)
  returning * into v_room;

  insert into public.plan_room_members (room_id, user_id)
  values (v_room.id, v_uid);

  return v_room;
end;
$$;

-- Join an existing room by code. Returns NULL when the code is unknown,
-- expired or closed — the caller turns that into honest UI copy rather than
-- leaking which of the three it was.
create or replace function public.join_plan_room(p_code text)
returns public.plan_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_room public.plan_rooms;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  -- Forward reference: public.plan_room_join_attempts is created LATER in this
  -- file. That is safe only because this function is `language plpgsql` (the
  -- body is not resolved at CREATE time) and the whole file runs in one
  -- transaction. If anyone ever splits this file or converts this function to
  -- `language sql`, move the table's create above this function first.
  --
  -- Throttle: 20 attempts per 10 minutes per account, enforced HERE so it
  -- cannot be skipped by calling the RPC directly. A successful guess
  -- self-enrols the guesser, so this is the enumeration perimeter, not the
  -- server action's counter.
  insert into public.plan_room_join_attempts (user_id, window_start, attempts)
  values (v_uid, now(), 1)
  on conflict (user_id) do update
    set attempts = case
          when public.plan_room_join_attempts.window_start < now() - interval '10 minutes'
          then 1 else public.plan_room_join_attempts.attempts + 1 end,
        window_start = case
          when public.plan_room_join_attempts.window_start < now() - interval '10 minutes'
          then now() else public.plan_room_join_attempts.window_start end;

  if (select attempts from public.plan_room_join_attempts where user_id = v_uid) > 20 then
    raise exception 'too many join attempts' using errcode = '53400';
  end if;

  select * into v_room
  from public.plan_rooms
  where code = p_code
    and closed_at is null
    and expires_at > now();

  if v_room.id is null then
    return null;
  end if;

  insert into public.plan_room_members (room_id, user_id)
  values (v_room.id, v_uid)
  on conflict (room_id, user_id) do update
    set left_at = null;  -- rejoining after a drop restores membership

  return v_room;
end;
$$;

-- Join-attempt throttle. Server-side because the RPC is reachable directly
-- over PostgREST: an app-layer limit on a granted function is decorative.
create table if not exists public.plan_room_join_attempts (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts     integer     not null default 0,
  primary key (user_id)
);
alter table public.plan_room_join_attempts enable row level security;
revoke all on public.plan_room_join_attempts from public, anon, authenticated;

-- Host-only closure.
create or replace function public.close_plan_room(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n   int;
begin
  update public.plan_rooms
     set closed_at = now()
   where id = p_room_id
     and host_user_id = v_uid
     and closed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Host liveness ping (host only; no-op for anyone else).
create or replace function public.touch_plan_room_host(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plan_rooms
     set host_seen_at = now()
   where id = p_room_id
     and host_user_id = (select auth.uid());
$$;

-- Deterministic host handoff. The DB — not the client — picks the winner:
-- the next member after the current host in the roster ring. The single
-- conditional UPDATE is the
-- race guard: concurrent callers all attempt the same transition and only
-- one row-version wins, so every client converges on one host.
create or replace function public.promote_plan_room_host(
  p_room_id       uuid,
  p_stale_seconds int default 30
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_new_host  uuid;
  -- 🧨 CLAMPED. This arrived as a caller argument, so a member could pass 0
  -- and strip the host role from a live, actively-pinging host (then close the
  -- room on everyone). The window is server-owned; the client cannot shorten it.
  v_stale     int  := greatest(coalesce(p_stale_seconds, 30), 30);
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  -- Only a member of this room may trigger a handoff.
  if not exists (
    select 1 from public.plan_room_members
    where room_id = p_room_id and user_id = v_uid and left_at is null
  ) then
    return null;
  end if;

  -- 🧨 ROTATE FORWARD from the outgoing host — do not simply re-run
  -- "earliest-joined active member who isn't the current host".
  --
  -- Measured on a live database 2026-07-29 (staging verification): with the
  -- simple exclusion, a room with members A (creator, joined 1st), B and C
  -- oscillated forever —
  --     round 1 -> B     round 2 -> A (the ORIGINAL, absent host)
  --     round 3 -> B     round 4 -> A ...
  -- because excluding only the CURRENT host makes the host we just replaced
  -- eligible again, and they are the earliest-joined. The room ping-pongs
  -- between two absent devices and never reaches a member who is actually
  -- there.
  --
  -- Taking the next member AFTER the current host in a stable (joined_at,
  -- user_id) ordering, wrapping to the front only when the host is last, turns
  -- handoff into a rotation: A -> B -> C -> A. It cannot two-cycle, and one lap
  -- reaches every remaining member, so a present device is found.
  --
  -- What this does NOT give you: it is not a guarantee that a caller cannot
  -- become host. In a three-member ring the caller is the next member half the
  -- time, and across an all-absent ring a member can walk the role to itself
  -- one hop at a time. The real controls are the server-clamped 30s staleness
  -- window and the conditional UPDATE below — a caller cannot shorten either,
  -- so the walk stops at the first member whose client is actually pinging.
  select m.user_id into v_new_host
  from public.plan_room_members m
  where m.room_id = p_room_id
    and m.left_at is null
    and (m.joined_at, m.user_id) > (
      select h.joined_at, h.user_id
      from public.plan_room_members h
      join public.plan_rooms r
        on r.id = h.room_id and r.host_user_id = h.user_id
      where h.room_id = p_room_id
    )
  order by m.joined_at asc, m.user_id asc   -- tiebreak: stable, not arbitrary
  limit 1;

  -- Host was last in the ring (or holds no membership row at all): wrap to the
  -- front, still excluding them so the UPDATE cannot no-op.
  if v_new_host is null then
    select m.user_id into v_new_host
    from public.plan_room_members m
    where m.room_id = p_room_id
      and m.left_at is null
      and m.user_id is distinct from (
        select r.host_user_id from public.plan_rooms r where r.id = p_room_id
      )
    order by m.joined_at asc, m.user_id asc
    limit 1;
  end if;

  -- Nobody else is left: leave the room as-is rather than nulling the host.
  if v_new_host is null then
    return (select host_user_id from public.plan_rooms where id = p_room_id);
  end if;

  update public.plan_rooms
     set host_user_id = v_new_host,
         host_seen_at = now()
   where id = p_room_id
     and closed_at is null
     and expires_at > now()
     and host_seen_at < now() - make_interval(secs => v_stale);

  return (select host_user_id from public.plan_rooms where id = p_room_id);
end;
$$;

-- Leave (used on unmount) — scoped to the caller.
create or replace function public.leave_plan_room(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plan_room_members
     set left_at = now()
   where room_id = p_room_id
     and user_id = (select auth.uid())
     and left_at is null;
$$;

-- Cleanup support: hard-delete rooms a week past expiry (members CASCADE).
-- Callable by service_role only — intended for a scheduled job, not clients.
create or replace function public.purge_expired_plan_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  -- Belt AND braces: grants are the primary control, but this is the one
  -- function with no auth.uid() check, so it also refuses any caller that is
  -- not the service role. `revoke ... from public` alone does NOT remove the
  -- default anon/authenticated grants Supabase hands new public objects.
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.plan_rooms
   where expires_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.create_plan_room(text)            from public, anon, authenticated;
revoke all on function public.join_plan_room(text)              from public, anon, authenticated;
revoke all on function public.close_plan_room(uuid)             from public, anon, authenticated;
revoke all on function public.touch_plan_room_host(uuid)        from public, anon, authenticated;
revoke all on function public.promote_plan_room_host(uuid, int) from public, anon, authenticated;
revoke all on function public.leave_plan_room(uuid)             from public, anon, authenticated;
revoke all on function public.purge_expired_plan_rooms()        from public, anon, authenticated;

grant execute on function public.create_plan_room(text)            to authenticated;
grant execute on function public.join_plan_room(text)              to authenticated;
grant execute on function public.close_plan_room(uuid)             to authenticated;
grant execute on function public.touch_plan_room_host(uuid)        to authenticated;
grant execute on function public.promote_plan_room_host(uuid, int) to authenticated;
grant execute on function public.leave_plan_room(uuid)             to authenticated;
grant execute on function public.purge_expired_plan_rooms()        to service_role;

-- Tables: read-only for clients, and nothing at all for anon.
revoke all on public.plan_rooms        from public, anon, authenticated;
revoke all on public.plan_room_members from public, anon, authenticated;
grant select on public.plan_rooms        to authenticated;
grant select on public.plan_room_members to authenticated;
