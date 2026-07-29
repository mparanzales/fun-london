# Environment proof (Phase 1) — 2026-07-29

All commands below are read-only. **No SQL was executed against any database in this task except the read-only catalog queries quoted here.**

## Branch and commit

```
$ git branch --show-current
fix/group-room-security
$ git rev-parse HEAD
9584e4ec53df507c3a948fb3d875990df3127c02
$ git status --short
(empty — clean tree)
```

## Supabase projects visible to this session

| ref (redacted) | name | status | verdict |
|---|---|---|---|
| `fxfuza…dopc` | fun-london | ACTIVE_HEALTHY | **PRODUCTION** — matches the ref recorded in `STATUS.md`; never a target |
| `rcecrn…fskx` | fun-london-dev | **INACTIVE (paused)** | designated dev project, currently not running |

## Migration role and Realtime ownership (the decisive finding)

Read-only query against the production catalog (no DDL, nothing written):

```sql
select current_user, session_user,
       (select rolname from pg_roles r
          join pg_class c on c.relowner = r.oid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname='realtime' and c.relname='messages') as owner,
       pg_has_role(current_user,'supabase_realtime_admin','MEMBER') as is_member;
```

```
current_user | session_user | owner                     | is_member
-------------+--------------+---------------------------+-----------
postgres     | postgres     | supabase_realtime_admin   | false
```

**Consequence:** `CREATE POLICY` / `DROP POLICY` on `realtime.messages` require table ownership. The migration role is not an owner and not a member of the owner, so **migrations 0002 and 0003 cannot be applied by `supabase db push`, the MCP `apply_migration` tool, or any CI migration step** — they will fail with `42501: must be owner of table messages`. This matches the note already in `supabase/realtime-policies.sql` (the live broad policies were created through the dashboard). Both migration files now carry this as a banner.

## Isolated-database options and why none could be used autonomously

| Option | Availability | Blocker |
|---|---|---|
| Supabase **branch** off production | Available via MCP | **Costs $0.01344/hour (~£7/month)** and `create_branch` requires an explicit cost confirmation from the account owner. Incurring recurring spend is a founder decision. |
| Resume **fun-london-dev** (`rcecrn…fskx`) | Project exists, INACTIVE | Resuming a paused project changes **shared** infrastructure (Vercel previews point at it) and resumes compute billing on the Pro org. Founder decision. |
| **Local Supabase** (`supabase start`) | Not available | Neither Docker nor the Supabase CLI is installed on this machine (`docker: not found`, `supabase: not found`). |

**Therefore Phases 2–12 of the staging brief were not executed.** No database was provisioned, so no migration was applied anywhere, and the multi-account tests could not run against real policies. Everything that follows in the verification document is labelled accordingly.
