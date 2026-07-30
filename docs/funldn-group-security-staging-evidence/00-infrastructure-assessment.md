# Phase 1 — Existing-infrastructure assessment

Read-only. Nothing was created, resumed, paused or deleted to produce this table.
Measured 2026-07-29 against the live Supabase management API and DNS.

## Git state

| Item | Value |
|---|---|
| Branch | `fix/group-room-security` |
| Commit at assessment | `0e7afae2aa2d015d34e88cc92ccf9192d0a2d0d6` |
| Working tree | clean (`git status --porcelain` empty) |

## Account inventory (live, not from repo files)

`list_projects` returns **exactly one project**:

| Field | Value |
|---|---|
| ref | `fxfuz…dopc` |
| name | fun-london |
| region | eu-west-2 |
| status | ACTIVE_HEALTHY |
| Postgres | 17.6.1.127 |
| organisation | FUN London (`sdtza…scbw`), plan **pro** |

## Finding 1 — the development project no longer exists

`fun-london-dev` (`rcecr…fskx`) was recorded in the previous session as *paused*. It is now
**gone**, confirmed two independent ways:

| Probe | Result |
|---|---|
| Management API `get_project` | `NotFoundException: Project not found` |
| DNS `rcecr…fskx.supabase.co` | `NXDOMAIN` |
| DNS `db.rcecr…fskx.supabase.co` | `NXDOMAIN` |
| DNS control: `db.fxfuz…dopc.supabase.co` | resolves (no A record, but the name exists) |

NXDOMAIN versus "no answer" is the discriminator: the production name exists and simply has
no A record; the dev name does not exist at all. **The existing-development-project path is
therefore unavailable — not paused, deleted.** Nothing was resumed, and nothing could have been.

## Finding 2 — branching is enabled, and it is billed outside the spend cap

`list_branches` on the production project returns a `main` branch whose `parent_project_ref`
is the production ref, so the branching feature is switched on and a new branch would be a
**child of the existing project, not a new project in the organisation**.

Cost, from `get_cost` and confirmed against Supabase's own billing documentation:

| Fact | Value | Source |
|---|---|---|
| Rate | **$0.01344 per hour**, Micro compute | `get_cost` + docs |
| Fixed fee | none — you pay only for hours the branch exists | docs |
| Compute Credits apply? | **No** — "Compute Credits do not apply to Branching Compute" | docs FAQ |
| Covered by Spend Cap? | **No** — branches are explicitly excluded | docs |
| Also billed | egress, and disk beyond the plan's included 8 GB | docs |

A 3–4 hour verification window that is deleted afterwards costs roughly **$0.04–$0.06**
(≈ £0.03–£0.05). Left running for a month it would cost ≈ **$9.68**. The charge is small but
it is real, it is not covered by the spend cap, and it lands on the invoice as
"Branching Compute Hours".

## Finding 3 — the no-cost local path is available

| Tool | Present at assessment | Installable | Admin password needed |
|---|---|---|---|
| Docker Desktop | no | — | would need one |
| `colima` (container runtime) | no | brew formula 0.10.3 | **no** |
| `docker` CLI | no | brew formula 29.6.2 | **no** |
| Supabase CLI | no | `brew tap supabase/tap` | **no** |

Homebrew is present at `/usr/local/bin/brew`, the account is in the `admin` group, and 161 GB
of disk is free. `colima` is used rather than Docker Desktop deliberately: it is a Homebrew
*formula*, so it installs without an administrator prompt and without Docker Desktop's
commercial-licence question, and `brew uninstall colima docker` reverses it completely.

## Decision table

| Option | New project? | Isolated? | Production data risk | Additional cost | Available now? |
|---|---|---|---|---|---|
| Branch inside existing project | No — child of `fxfuz…dopc` | Yes, separate instance | None (branch is seeded without production data) | **$0.01344/hr**, outside spend cap, no compute credits | Yes |
| Existing `fun-london-dev` project | n/a | n/a | n/a | n/a | **No — the project has been deleted** |
| Local Supabase (colima + CLI) | No | Yes, loopback only | None — never contacts Supabase | **£0** | Yes, after a local tool install |

## Route selected

**Local Supabase stack.** It is the only route satisfying all three conditions in the
authorisation boundary: it creates no project, it never contacts production, and it costs
nothing. The branch route was *not* taken, because it carries a charge — however small — and
the brief requires explicit approval before incurring one.

### Honest fidelity limits of the local route

| Question | Can local answer it? |
|---|---|
| Do the membership-scoped policies actually deny a non-member? | **Yes** — real Postgres, real RLS, real Realtime, real auth users. |
| Does closure / expiry / host handoff / throttle behave correctly? | **Yes.** |
| Does `supabase db push` fail on `realtime.messages` for lack of ownership? | **No.** Locally the `postgres` role is effectively superuser, so the production ownership constraint does not reproduce. That constraint was instead measured directly against production, read-only — see below. |
| Is the dashboard "Allow public access to channels" toggle set correctly in production? | **No** — that is a hosted-project setting and remains a production prerequisite. |

## Production read-only capture (permitted; no writes)

Re-measured today, on `fxfuz…dopc`, using `select` only:

| Fact | Value |
|---|---|
| `current_user` | `postgres` |
| Owner of `realtime.messages` | `supabase_realtime_admin` |
| `pg_has_role(postgres, supabase_realtime_admin, 'MEMBER')` | **false** |
| Policies on `realtime.messages` | 2 |
| `public` schema functions matching `%room%` | **0** — 0001 has never been applied |
| Accounts in `auth.users` | 16 |

The two live policies, captured verbatim from `pg_policies`:

```
"authenticated can read plan-together rooms"  SELECT  {authenticated}
  USING  ((SELECT realtime.topic()) ~~ 'plan-%' AND extension = ANY(ARRAY['broadcast','presence']))

"authenticated can write plan-together rooms" INSERT  {authenticated}
  WITH CHECK ((SELECT realtime.topic()) ~~ 'plan-%' AND extension = ANY(ARRAY['broadcast','presence']))
```

Any signed-in user may read and write **any** `plan-*` topic. That is the live vulnerability,
re-confirmed today rather than recalled, and it is still unpatched in production.

## Defect this assessment found in our own harness

Production holds **16** accounts. The harness's secondary environment guard refused to run
only when the target held **25 or more** accounts — so on the one database it existed to
protect, it could never have fired. A count cannot distinguish a small real cohort from a
fresh stack. It was replaced with an identity test: every account the suite creates matches
`fl-staging-<label>-<ts>-<rand>@example.invalid`, and the presence of *any* account that does
not match aborts the run. That guard fires on production (16 non-fixture accounts) and passes
on a genuinely empty stack.
