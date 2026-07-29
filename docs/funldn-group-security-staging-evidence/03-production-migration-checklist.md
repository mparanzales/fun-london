# Production migration checklist (printable)

Do not start until staging has been run. Every step is Maria's to approve and, for the dashboard steps, to perform.

- [ ] **0.** Verified DB backup exists. Snapshot `pg_policies` for `realtime.messages` + the `public` room objects to a dated file.
- [ ] **1.** Apply `0001_plan_rooms.sql` (normal migration path — `public` objects only). *Approver: Maria.*
- [ ] **2.** `EXPECT_STAGE=1 pnpm verify-room-security` → exit 0.
- [ ] **3.** Merge + deploy the client. Watch room create/join for errors. *Maria merges.*
- [ ] **4.** Paste `0002_realtime_membership_policies.sql` into the **Supabase dashboard SQL editor** (owner-level; the CLI cannot do this). *Maria, manually.*
- [ ] **5.** `EXPECT_STAGE=2 pnpm verify-room-security` → membership-scoped policies present alongside the broad ones.
- [ ] **6.** Two real accounts complete a room end to end.
- [ ] **7.** Third, uninvited account: confirm it CAN still get in at this stage (the broad policy still permits) — this is the baseline that makes step 9 provable.
- [ ] **8.** Paste `0003_drop_broad_realtime_policies.sql` into the dashboard SQL editor. **This is the only step that removes access.** *Maria, manually.*
- [ ] **9.** `EXPECT_STAGE=3 pnpm verify-room-security` → **must exit 0**. Repeat step 7's attempt: it **must now be denied**. Members from step 6 must be uninterrupted.
- [ ] **10.** Smoke: closure, expiry (disposable room), host handoff across two real sessions.
- [ ] **11.** Monitor 48h: `together_room_create/join`, `together_join_denied`, subscribe errors, Vercel runtime errors.
- [ ] **12.** Rollback trigger hit? → paste the two `create policy` statements from `0003`'s header into the dashboard (one statement pair), then investigate. `0001`'s tables are inert without the policies and can stay.
