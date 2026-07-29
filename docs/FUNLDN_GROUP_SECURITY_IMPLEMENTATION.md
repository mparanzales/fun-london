# Fun London — Group-Room Security Implementation

Branch `fix/group-room-security`, off `main` @ `0d35d47`. Security and infrastructure only: **no interface redesign, no group-plan saving, no change to solo planning, navigation or identity.** Nothing is merged and nothing is deployed — the migrations are files in the repo, not applied to any database.

## 1. The previous exposure

Verified against production during the foundation audit (2026-07-29):

| # | Exposure | Evidence |
|---|---|---|
| 1 | **Any signed-in user who guessed a room code could read and write that room's channel.** The Realtime policies on `realtime.messages` were `topic() like 'plan-%' and extension in ('broadcast','presence')` for role `authenticated` — no membership condition of any kind. | live `pg_policies`; `supabase/realtime-policies.sql` states the gap in its own "WHAT IS STILL OPEN" note |
| 2 | **Room codes were 4 characters** from a 32-char alphabet (~1.05M combinations) with **no join rate limit** — enumerable. | `lib/realtime/room.ts:125-130` (pre-change) |
| 3 | **Member identity was client-minted** (`crypto.randomUUID()`), and every vote/reaction/taste payload carried its own `memberId`. One client could emit N payloads as N invented members and manufacture a veto majority. | `makeMember()` pre-change; `sendVote`/`sendReact` payloads |
| 4 | **No persistence at all** — no rooms table, no membership, so there was nothing to authorise against, no expiry, and no way to end a room. | no `plan_rooms`/`plan_room_members` in the live schema |
| 5 | **Host died with the host's tab.** Host was "did my URL have `?room`"; when the host left, no device held the role and majority-veto swaps silently stopped applying. | `together-flow.tsx` pre-change; `_steps/result.tsx:178-190` documents the consequence |
| 6 | **Subscription failures were silent** — only `SUBSCRIBED` was handled, so a timeout, an RLS rejection or a dropped network left the user on "Setting up your room…" forever. | `room.ts` subscribe callback, pre-change |

## 2. New architecture

**The database owns identity, membership, expiry and the host role. Realtime carries only live traffic.**

- `public.plan_rooms` — `id`, `code` (unique, 6-char), `topic` (`'plan-' || code`, unique, so the RLS predicate is an exact lookup), `host_user_id → auth.users`, `created_at`, `expires_at` (default `now() + 6 hours`), `closed_at` (nullable), `host_seen_at` (host liveness).
- `public.plan_room_members` — `(room_id, user_id)` primary key, `user_id → auth.users` (**this is the authoritative member identity**), `joined_at`, `left_at`.
- `public.is_plan_room_member(topic)` — SECURITY DEFINER, `search_path = ''`; true only when the caller has a non-departed membership row for that topic **and** the room is neither closed nor expired. Used by the **Realtime** policies.
- `public.is_plan_room_participant(room_id)` — membership only, no liveness conditions. Used by the **table-read** policies so a member can still read *why* a room stopped (without it, a closed room becomes invisible and the honest-failure copy can never fire).
- `public.plan_room_join_attempts` — the join throttle, enforced **inside** `join_plan_room` because the RPC is directly reachable over PostgREST; an app-layer limit on a granted function is decorative.
- **Writes go exclusively through SECURITY DEFINER functions** (`create_plan_room`, `join_plan_room`, `close_plan_room`, `touch_plan_room_host`, `promote_plan_room_host`, `leave_plan_room`, `purge_expired_plan_rooms`). None takes a user id, member id or host flag — every one derives the actor from `auth.uid()`. There are deliberately **no INSERT/UPDATE/DELETE policies for clients** on either table.
- **Client identity**: `memberFromSession(userId, name)` — the member id *is* the authenticated user id. `makeMember()`/`randomId()` are gone.
- **Roster gating** (`lib/room-roster.ts`): the roster comes from the database; every inbound vote/done/react/taste payload and every presence entry is checked against it **once the roster is known** (before that the channel's own RLS is the control — gating against an unloaded roster would drop the whole group), and a payload stamped with my id that I did not actually send is dropped.
- **Host-authored broadcasts** (`settings`, `swap`, `swaps`, `variant`) carry a `from` stamp and are accepted only from the DB-recorded host, so a member cannot re-plan the room from the console.
- **Host** (`lib/room-host.ts` + `promote_plan_room_host`): the client knows who is *present* and decides **when** a handoff is needed and who should ask; the database decides **who gets it** — the earliest-joined member **excluding the outgoing host** — via a conditional UPDATE with a server-clamped staleness window. The DB is the authority; the client is the trigger.
- **Analytics correlation** uses the room's UUID, never the code (a code is a bearer token; the salted hash is reversible because the salt ships in the bundle), and PostHog's `sanitize_properties` strips `room=` from every URL-shaped property.
- **Failure states** (`lib/room-errors.ts`): `timeout · channel-error · denied · expired · closed · not-found · offline · auth`, each with short honest copy in the existing voice, rendered by a minimal notice inside the existing layout.

## 3. Migration sequence (staged; never a big-bang replacement)

| Step | File | Effect | Gate before proceeding |
|---|---|---|---|
| 1 | `0001_plan_rooms.sql` | Tables, indexes, RLS, membership predicate, write functions, grants. **Purely additive — no existing policy or table is touched**, so live rooms keep working unchanged. | `pnpm tsx scripts/verify-room-security.ts` reports stage 1 healthy |
| 2 | *(deploy the client)* | The app starts creating/joining membership records, so the new predicate has rows to match. | Rooms work as before; new rows appear in `plan_rooms` |
| 3 | `0002_realtime_membership_policies.sql` | **Adds** membership-scoped read+write policies **alongside** the broad ones. Postgres ORs permissive policies, so this cannot break a live room — it is the dual-run checkpoint. | Script reports **stage 2 (DUAL-RUN)**; two-account test passes (§6) |
| 4 | `0003_drop_broad_realtime_policies.sql` | **Drops** the two broad `plan-%` policies. This is the only step that removes access. | `EXPECT_STAGE=3 pnpm tsx scripts/verify-room-security.ts` exits 0 — it asserts the stage reached, that **no** unscoped policy of any name remains, and the function grants |

## 4. Policies (after step 4)

```
realtime.messages · "plan room members read"  (SELECT, authenticated)
  topic() like 'plan-%' AND extension in ('broadcast','presence')
  AND public.is_plan_room_member(topic())
realtime.messages · "plan room members write" (INSERT, authenticated)
  …same predicate in WITH CHECK
public.plan_rooms        · "plan_rooms member read"        (SELECT only)
public.plan_room_members · "plan_room_members member read" (SELECT only)
```
No client-facing write policy exists on either new table by design.

## 5. Rollback

- **After 0001 or 0002 (nothing removed yet):** `drop policy if exists "plan room members read"/"plan room members write" on realtime.messages;` then `drop table public.plan_room_members, public.plan_rooms cascade;` and drop the seven functions. Behaviour returns to today's exactly.
- **After 0003 (access removed):** re-create the two broad policies — their verbatim text is kept in the header of `0003_drop_broad_realtime_policies.sql` precisely so a rollback needs no archaeology. This restores the old (permissive) behaviour in one statement pair while the cause is investigated.
- **Client rollback:** revert the branch. The client tolerates a missing room record by surfacing an honest failure rather than crashing, but the intended rollback is git-level, not partial.

## 5b. Review findings and what changed because of them

Both required gates ran before this was presented as complete. **Neither returned clean, and both changed the code** — recorded here because a review whose findings are invisible is theatre.

**`code-reviewer` — 5 blockers.** (1) The roster gate collapsed the group to one member: the guard fell back to `{me}` while the roster was still loading, `filterPresence` dropped everyone, and nothing re-filtered when the roster landed — the last joiner would sit alone, build a *different* plan, and satisfy the "everyone's done" barrier by themselves. Fixed with a `rosterLoaded` switch (gate closed only once membership is known) plus a re-filter effect on the last presence snapshot. (2) Host handoff could never fire (see guardian #6 below). (3) A stale closure froze `members` at `[me]`, so every device would have claimed host — fixed with a ref before the review landed. (4) The raw room code reached PostHog on every event via the autocaptured `$current_url` — fixed with a `sanitize_properties` hook that redacts `room=` from every URL-shaped property. (5) `settings`/`swap`/`swaps`/`variant` were ungated, so any member could re-plan the room from the console — now stamped `from` and accepted only from the DB-recorded host. Also fixed: the vacuous `selfEcho` check (now backed by real outbound-key tracking), teardown-induced false "offline" failures, an expired room re-firing analytics every 10s, a silently-vanishing room, and a "Try again" link that dropped joiners into a brand-new empty room.

**`supabase-guardian` — SHIP WITH FIXES, 4 blockers + 3 highs.** (1) `revoke … from public` does **not** remove Supabase's default `anon`/`authenticated` grants — `purge_expired_plan_rooms` was reachable with the anon key. Now revoked from all three roles explicitly (house convention) *and* self-guarded on `current_user`. (2) The join throttle lived only in the server action, but `join_plan_room` is granted to `authenticated` and therefore reachable directly over PostgREST — the limit is now enforced **inside the function** against a `plan_room_join_attempts` table, which matters because a successful guess self-enrols the guesser. (3) `p_stale_seconds` was caller-controlled, so a member could pass `0` and strip the role from a live host — now clamped server-side to ≥30s. (4) The verification script's stage-3 assertion was a tautology (stage 3 was *defined* as "no broad policies", then asserted the same thing) and it was blind to any other permissive policy — it now takes `EXPECT_STAGE` from the operator, asserts that *no* unscoped policy of any name remains, and checks the function grants directly. (5) Closed/expired rooms became unreadable to their own members, so the honest-failure copy could never fire — the table-read policies now use a membership-only predicate (`is_plan_room_participant`) while Realtime keeps the strict one. (6) Host handoff re-picked the departed host and no-oped forever; the successor query now excludes the outgoing host. (7) The analytics room hash is reversible (the salt ships in the bundle) — analytics now correlates on the room's UUID, and the denied-join event carries no room identifier at all.

**Not adopted this round, recorded as open:** per-member `last_seen_at` heartbeats (would make the DB and client host rules genuinely identical rather than "client triggers, DB decides"); scheduling `purge_expired_plan_rooms`; shortening the 7-day post-expiry retention of the membership graph; `sendBeacon`-based leave. These are follow-ups, not blockers, and are listed in §8.

## 6. Testing

**Automated — full suite green: 332 tests / 38 files, `tsc --noEmit` clean, `next lint` clean (one pre-existing unrelated warning), `next build` succeeds, no-dashes copy guard passes.** New coverage:

| Claim | Test |
|---|---|
| Codes are six characters, unambiguous alphabet, non-repetitive | `lib/room-code.test.ts` |
| Room code never survives into its analytics hash | `lib/room-code.test.ts` |
| Invented members are rejected (majority cannot be inflated) | `lib/room-roster.test.ts` |
| A payload claiming to be me that I did not send is rejected | `lib/room-roster.test.ts` |
| Presence entries off the roster are dropped | `lib/room-roster.test.ts` |
| Host handoff is deterministic across devices and orderings; ties break by user id | `lib/room-host.test.ts` |
| Exactly one device claims host (no multi-host race) | `lib/room-host.test.ts` |
| Every subscribe/join failure maps to honest copy | `lib/room-roster.test.ts` |
| Membership predicate requires member AND not-departed AND not-closed AND not-expired | `scripts/__tests__/room-security-migrations.test.ts` |
| No write function accepts a user id; every definer pins `search_path` | same |
| 0001 is additive; 0002 removes nothing; **0003 removes BOTH broad `plan-%` policies** | same |
| No migration touches plans/venues/saved_venues/bookings/profiles | same |
| Rooms expire after ~6 hours by default | same |
| Revokes cover public AND anon AND authenticated | same |
| Purge is service_role-only and self-guards on `current_user` | same |
| The join throttle is enforced in the database, not just the action | same |
| The host-staleness window is clamped server-side | same |
| Host handoff excludes the outgoing host | same |
| Table reads stay readable for closed/expired rooms | same |
| Room codes are shape-pinned (no 4-char room via a direct RPC) | same |
| Create-path throttling shows create copy, not join copy | `lib/room-roster.test.ts` |

**Not provable in unit tests** (they need a live database and two sessions): that Postgres actually denies a non-member's subscribe, that an expired/closed room actually denies, and that join rate-limiting trips under real load. Those are §7's manual steps, and `scripts/verify-room-security.ts` is the automated half of that gate.

## 7. Production verification steps (manual, in order)

Nothing below has been performed — the migrations are unapplied.

1. **Apply `0001` only.** Run `pnpm tsx scripts/verify-room-security.ts` → expect stage 1, tables + definer functions present, no client write policies, RLS on.
2. **Deploy the client** (this branch, after merge). Open `/plan/together` as account A → a room is created; confirm a row in `plan_rooms` and one in `plan_room_members`, and that the URL code is **6 characters**.
3. **Two-account test (A hosts, B joins).** B opens A's invite link → B appears in the lobby, swipes, and both see the same result. Confirm a second `plan_room_members` row.
4. **Apply `0002`.** Re-run the script → expect **stage 2 (DUAL-RUN)**, ≥2 membership-scoped policies, broad policies still present. Repeat step 3 to confirm nothing regressed.
5. **Third-account test (C, unrelated, not invited).** C opens `/plan/together?room=<A's code>` → with 0002 alone C may still get in (the broad policy still permits); this step exists to establish the baseline before step 6.
6. **Apply `0003`.** Re-run the script → expect **stage 3 (FINAL)** and `broad plan-% = 0`. Then: C retries → **must be denied** (honest "You're not in this room" copy, no live traffic). A and B, already members, must continue uninterrupted.
7. **Expiry.** Set one test room's `expires_at` to the past by hand → its members must lose access on the next tick and see "That room has expired".
8. **Closure.** As host, use "End this room" → `closed_at` set; members see "That room was closed".
9. **Host handoff.** With A and B in a room, close A's tab; after ~30 s B must become host on every device (check `host_user_id` flipped to B, and only once).
10. **Rate limit.** Attempt >20 joins in 10 minutes with one account → later attempts return the denied state.
11. **Cleanup.** Delete the test rooms (`delete from plan_rooms where code in (...)`), or leave them to expire and be purged.

## 8. Remaining limitations (honest)

1. **Member-to-member impersonation inside a real roster is still possible.** Broadcast payloads are client-authored, so member A can still stamp a payload with member B's user id, and other devices cannot cryptographically disprove it. What is now impossible is *inflating the group beyond its real membership* — both the voter set and the majority denominator are server-owned. Closing this fully requires server-authoritative votes (writes to the database instead of broadcast), which is a product change, not a security patch. **Do not describe voting as tamper-proof in any copy.**
2. **Presence is still self-reported** — a member can appear/disappear at will; the roster bounds who counts, not who is genuinely looking at the screen.
3. **`leaveRoom` is best-effort** (`pagehide`); a hard crash leaves a stale membership row until expiry. Host handoff tolerates this via the liveness stamp.
4. **`purge_expired_plan_rooms()` has no scheduler yet** — it is `service_role`-only and ready for a cron; rooms simply stop working at expiry regardless.
5. **The verification script needs a read-only SQL helper RPC** (`exec_sql_readonly`) or the equivalent queries run by hand in the SQL editor; it does not create one, because adding a SQL-executing RPC is itself a security decision for the founder.
6. **Group results still cannot be saved** — deliberately out of scope for this track (decision register #11).
7. **The client and database host rules are related, not identical.** The client knows who is *present* and decides when a handoff is needed; the database knows who has not written `left_at` and decides *who gets it*. They can disagree for a member who is recorded but not watching; the database's answer wins and every device reads it back. Making them identical needs per-member `last_seen_at` heartbeats (follow-up).
8. **`purge_expired_plan_rooms()` still has no scheduler**, and retains rooms 7 days past expiry. `plan_room_members` is a who-planned-with-whom social graph: schedule the purge and consider shortening the window before a wider beta.
9. **Realtime authorization is evaluated at join.** An already-subscribed socket may keep broadcasting briefly after `closed_at`/`expires_at`; §7 step 7 is the test that establishes the real behaviour. Do not claim instant revocation in copy until it is measured.
10. **The verification script still needs a read-only SQL path** (an `exec_sql_readonly` RPC, or running its queries over `psql`). If that RPC is ever created it must be SECURITY INVOKER, revoked from `public, anon, authenticated`, and granted to `service_role` only — otherwise it is a worse hole than the one this track closed.
