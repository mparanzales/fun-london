-- ─────────────────────────────────────────────────────────────────────────
-- Realtime access policies for Plan Together rooms.
--
-- ⚠️ NOT APPLIED AUTOMATICALLY. Paste this into the Supabase SQL editor.
--    Nothing in this repo runs it, and schema.sql does not contain it.
--
-- THE GAP THIS CLOSES
--
-- lib/realtime/room.ts subscribes with `private: true` and hands Realtime the
-- signed-in user's access token. That flag only means "enforce RLS on
-- realtime.messages" — it is not access control by itself. Until this file is
-- applied there is NO policy on realtime.messages, so the room channel is
-- effectively open: anyone holding the (public, client-side) anon key who
-- guesses a 4-character room code can read everything broadcast into it,
-- including the taste maps members share.
--
-- scripts/prove-group-veto.ts demonstrates this today: it subscribes with no
-- auth at all and still works.
--
-- WHAT THIS DOES AND DOES NOT DO
--
--   Does:     restricts plan-* channels to SIGNED-IN users. Anonymous clients
--             on the anon key can no longer read or write them.
--   Does NOT: restrict a signed-in user to rooms they were invited to. Room
--             membership is deliberately ephemeral (there is no rooms table),
--             so there is nothing to join against. A signed-in user who
--             guesses a code can still enter.
--
-- That residual risk is accepted for now: codes are ~1M combinations, rooms
-- are short-lived, and the contents are venue preferences. Closing it properly
-- means persisting room membership, which is a product decision, not a patch.
-- Do not describe rooms as "private" in user-facing copy until it is done.
--
-- AFTER APPLYING
--
--   1. `pnpm tsx scripts/prove-group-veto.ts` should now FAIL to subscribe.
--      That failure is the fix working. Give the harness a signed-in token.
--   2. Open a room on two signed-in devices and confirm they still sync.
-- ─────────────────────────────────────────────────────────────────────────

alter table realtime.messages enable row level security;

drop policy if exists "plan rooms readable by signed-in users" on realtime.messages;
create policy "plan rooms readable by signed-in users"
  on realtime.messages
  for select
  to authenticated
  using (realtime.topic() like 'plan-%');

drop policy if exists "plan rooms writable by signed-in users" on realtime.messages;
create policy "plan rooms writable by signed-in users"
  on realtime.messages
  for insert
  to authenticated
  with check (realtime.topic() like 'plan-%');
