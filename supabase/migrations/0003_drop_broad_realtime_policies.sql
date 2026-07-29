-- ─────────────────────────────────────────────────────────────────────────
-- 0003 · Remove the broad plan-% Realtime policies.
--
-- STEP 3 OF 3 — THE ONLY STEP THAT REMOVES ACCESS. Run it only after
-- `pnpm tsx scripts/verify-room-security.ts` reports the membership path
-- healthy on production (see the doc's "Production verification" section).
--
-- Before: any authenticated user who guessed a room code could read and write
-- that room's channel. After: only recorded, non-departed members of a room
-- that is neither expired nor closed.
--
-- Rollback (immediate, safe): re-create the two policies below verbatim —
-- this is the pre-change state, kept here so a rollback needs no archaeology.
--
--   create policy "authenticated can read plan-together rooms"
--     on realtime.messages for select to authenticated
--     using ((select realtime.topic()) like 'plan-%'
--            and extension in ('broadcast','presence'));
--
--   create policy "authenticated can write plan-together rooms"
--     on realtime.messages for insert to authenticated
--     with check ((select realtime.topic()) like 'plan-%'
--                 and extension in ('broadcast','presence'));
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "authenticated can read plan-together rooms"  on realtime.messages;
drop policy if exists "authenticated can write plan-together rooms" on realtime.messages;
