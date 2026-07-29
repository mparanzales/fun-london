# Review verdicts

## Round 1 — pre-staging gates (commit 9584e4e)

| Gate | Verdict | Outcome |
|---|---|---|
| code-reviewer | 5 blockers | All fixed (roster-gate collapse, host handoff, stale closure, room code in PostHog URLs, ungated host-authored broadcasts) + 4 should-fixes |
| supabase-guardian | SHIP WITH FIXES — 4 blockers, 3 highs | All fixed (grants vs anon, DB-side join throttle, clamped stale window, tautological verify gate, closed-room readability, handoff candidate set, reversible analytics hash) |

Detail: `docs/FUNLDN_GROUP_SECURITY_IMPLEMENTATION.md` §5b.

## Round 2 — harness delta (commit 9f22a32 → 0e7afae)

| Gate | Verdict | Outcome |
|---|---|---|
| code-reviewer | NOT READY — 5 blockers, all false-pass class | All fixed |
| supabase-guardian | DO NOT SHIP as a runnable gate | All fixed |

## Round 3 — the live staging delta

Both gates re-run against the delta produced by the actual staging run.

| Gate | Verdict | Blockers |
|---|---|---|
| supabase-guardian | **SHIP WITH CHANGES** — "the rotation fix itself is correct, I could not break it" | 2, both in the evidence apparatus rather than the SQL |
| code-reviewer | **NOT READY** | 2, plus 8 should-fix/nits |

Neither blocker was in the migration. Both gates independently found the same thing: **the code
written to prevent false passes contained false passes.**

### Blockers, and what was done

**1. `H-4` could pass having measured nothing.** It is the only check that proves the handoff
defect is fixed. It discarded the RPC error (`const { data: next }`) and its detector skipped
nulls, so three failed calls produced `[B, null, null, null]` and scored PASS. Both gates
flagged it independently.
*Fixed:* every round's error is captured, any missing answer is INCONCLUSIVE, and the assertion
is now positive — all three members appear and no two consecutive rounds repeat — instead of
"nothing repeated at a distance of two", which `[B, B, C, C]` would have satisfied. H-3 and H-4
are also gated on H-1, the same way the realtime denials are gated on the positive controls.

**2. The guard tests pinned strings the broken rule also contained.** The only CI guard on
handoff asserted the SQL contained `is distinct from (` and `host_user_id from public.plan_rooms`
— both of which live in the wrap branch, so **reverting `0001` to the measured-broken rule left
CI entirely green**. Given this repo's history of commits stranded by squash-merge, that was not
acceptable for the one rule a live staging run was burned to find.
*Fixed:* the guard now asserts the ordered-tuple forward scan appears *before* the wrap branch
and compares against the current host's roster position. The predicates themselves were
extracted to `scripts/staging-guard.ts` so the tests exercise **behaviour** — `isLoopback` is
now run against `http://127.0.0.1.attacker.example/` and `http://user@127.0.0.1@evil.com/`
rather than grepped for.

**3. Nothing proved `anon` had lost SELECT on the room tables** (guardian). Production grants
every new public table `anon = SELECT` by default, and `0001`'s revoke is the only thing that
removes it — but both RLS policies are `to authenticated`, so a signed-out caller reads zero
rows *whether or not the revoke applied*. `AN-1` asserted "0 rows" and could therefore never
fail on the regression it existed to catch. The column-grant moat is the control this project
has repeatedly identified as load-bearing.
*Fixed:* `AN-1` now requires the permission error `42501`; `AN-3`/`AN-4` were added for the
other two tables; and the gate asserts `has_table_privilege('anon', …)` from the catalog.
*Proved it can fail:* re-granting `select on plan_rooms to anon` makes the gate print
`❌ anon holds NO select grant…` and **exit 1**; revoking it again returns exit 0.

**4. A `SKIP` exited 0** (code-reviewer). The header promises "Exit 0 only when every check is
PASS", but the exit calculation ignored SKIP — and the expiry block recorded SKIPs when its
fixture failed to build, so those invariants could go unexecuted behind a green run.
*Fixed:* an unmet fixture precondition is now INCONCLUSIVE, and SKIP counts toward a non-zero
exit.

### Should-fixes also applied

- `H-0` asserted only "no error", but `join_plan_room` returns NULL *without* an error for an
  unknown, closed or expired code — the identical false-pass `E-1` had just been fixed for. It
  now asserts the membership rows exist.
- `E-1`'s `(expMembers ?? 0) === 0` scored a null count as zero rows; null is now INCONCLUSIVE.
- `EXPECT_STAGE=three` yielded `NaN`, which is falsy, so the gate printed "reporting only, not
  gating" and **exited 0** — the same family as "the CI secret was an empty string". It now
  refuses anything that is not 1, 2 or 3. Verified: exit 1.
- `verify-room-security.ts` loaded no dotenv while every sibling does, so it would have exited 1
  on a real machine even after the `server-only` fix. Now loads `.env.local`.
- The rule this change deletes was still documented as live in five places, including
  `lib/room-host.ts` — the client/DB contract doc a future reader goes to first. All corrected.
- The rollback instructions understated the blast radius: "two tables and three functions" when
  `0001` creates **three** tables and **nine** functions, and omitted `plan_room_join_attempts`
  entirely — a rollback following them would leave a table of user ids behind. Corrected in both
  the migration header and the implementation doc.
- A guard test now asserts no script under `scripts/` imports the `server-only` admin client.
  Verified the detector actually finds the two known-broken siblings.

### Accepted, recorded rather than fixed

- Handoff convergence costs up to 30s per absent member.
- A member can walk the host role to themselves across an all-absent ring — a new capability,
  bounded by the 30s clamp and by already holding the code. Recorded in the verification doc §7.
- `verify-feed-rank.ts` and `verify-plan.ts` remain dead the same way the gate was. Out of
  scope; logged as follow-up, with the trap noted (adding `server-only` as a dependency does not
  fix them — it throws by design under Node).

### Guardian's read of the SQL

Answered in detail and worth keeping: the row-comparison subquery yields NULL when the host has
no membership row, so it correctly falls through to the wrap branch; it cannot return more than
one row; both row elements are `not null`; operator resolution is safe under `search_path = ''`
because `>`, `now()` and `make_interval()` all come from `pg_catalog`; no `FOR UPDATE` is needed
because concurrent callers compute the same successor and the conditional UPDATE's staleness
predicate makes the loser a no-op under READ COMMITTED; and a member cannot re-join to
reposition themselves in the ring because the upsert clears `left_at` without touching
`joined_at`.
