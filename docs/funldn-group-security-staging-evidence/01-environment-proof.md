# Environment proof — 2026-07-29

Two things have to be true before any of the results in `02-test-matrix.md` mean anything:
the target must not be production, and it must not belong to real people. Both were proved
by measurement, not by naming a variable "staging".

## The target

| Property | Value |
|---|---|
| Kind | local Supabase CLI stack (`supabase start`), Docker via colima |
| API | `http://127.0.0.1:54321` — loopback |
| Database | `127.0.0.1:54322`, Postgres 17 |
| Project directory | `~/.fl-local-staging` (temporary; deleted at teardown) |
| Hosted project involved | **none** |
| Cost | **£0** |

Nothing on loopback can be a hosted Supabase project. That is the isolation argument, and it
is structural rather than procedural — there is no configuration mistake that turns
`127.0.0.1` into `fxfuz…dopc`.

## Guard 1 — the production denylist ran first

`assertStaging()` runs before any client is constructed. The production ref is a hard denylist
checked against both `STAGING_PROJECT_REF` and the URL, and — for hosted targets — against the
project ref decoded from the service key's own JWT payload, so a custom domain or a mislabelled
env var cannot disguise the target.

The loopback branch is entered only after that denylist, and it proves loopback by **parsing**
the URL:

```ts
const host = new URL(url).hostname.toLowerCase();
return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
```

A substring test would have accepted `http://127.0.0.1.attacker.example/`, whose host is not
loopback at all.

Observed banner from every run in this task:

```
Target: http://127.0.0.1:54321 (local CLI stack, loopback-verified) ✓
```

## Guard 2 — the target holds nobody real

This guard was rebuilt during this task because the previous version could not have worked.

It refused only when the target held **25 or more** accounts. Production was then measured
read-only: `select count(*) from auth.users` → **16**. On the one database the guard existed
to protect, it was inert — a count cannot separate a small real cohort from a fresh stack.

It now tests identity. Every account the suite creates matches

```
/^fl-staging-[a-z]-\d+-\d+@example\.invalid$/
```

and the presence of **any** account that does not match aborts the run before a single row is
written. `.invalid` is unroutable by RFC 2606, so no fixture address can ever reach a person.
Observed:

```
✅ [ENV-0] target holds no real user accounts — 0 account(s), 0 not test fixtures
```

Against production the same guard would see 16 non-fixture accounts and refuse.

## The stack was made faithful to production before testing

A fresh CLI stack is *safer* than production in one respect that would have invalidated the
anon results. Default privileges for role `postgres` on new public tables:

```
production : {postgres=arwdDxtm, anon=rm, authenticated=rm, service_role=arwdDxtm}
local CLI  : {postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}
```

In production every new table is born with **anon = SELECT**, and 0001's
`revoke all … from anon` is what takes it away. Locally that grant never existed, so the anon
checks would have passed whether or not the revoke were present — a check that cannot fail.
A local-only fixture aligns the defaults to production's before any migration runs. After the
alignment, the room tables show `anon` with **no privileges at all**, which is 0001's revoke
visibly doing work.

The same gap also left `service_role` with no DML, which is why PostgREST answered `42501` for
the admin client on the first attempt. That was a local artifact, not a defect in 0001 — the
identical shortfall appears on `venues`, a table 0001 never touches.

## What was done to production

Read-only inspection only, via the Supabase management API:

- `select current_user`, ownership of `realtime.messages`, `pg_has_role(...)`
- `select … from pg_policies where schemaname='realtime'`
- `select … from pg_default_acl`, `information_schema.role_table_grants`
- `select count(*) from auth.users`
- a check that no `%room%` function exists in `public` — **0**, confirming 0001 has never
  been applied there

No migration, no policy change, no RPC change, no test room, no test account, no write of any
kind. `list_branches` on the production project still shows only `main`; no database branch
was created, so no branch-compute charge was incurred.
