# The canonical NightPlan (Phase 2 foundation)

## Why

A night had three incompatible shapes and no single owner:

| Shape | Where | What it carries |
|---|---|---|
| `Plan` | `lib/plan-engine.ts` | full `Venue` objects, `Date` arrivals, `alternatives[][]` |
| `plans.steps` | the database | `venueId`, `role`, `dwellMins`, `walkToNextMins` — nothing else |
| `AnonPlanStop` | `lib/plan-preview-shape.ts` | flat card fields, moat-stripped |

Nothing converted between them, so each flow grew its own reconstruction:
`openSaved` rebuilt one shape and **inferred the daypart from whether the title
contained "Day Out"**, the anon path used a one-shot localStorage stash read
exactly once at sign-in, and a refresh lost the night outright.

## The model

`lib/night-plan.ts` is the interchange format: plain JSON, venue **references**
(id *and* slug) rather than venue rows, `startsAt` as an ISO string, and a
`createdAt` stamp that drives freshness.

Storing references rather than rows is what keeps it on the right side of the
anon moat: a signed-out browser can hold a whole night without a single moat
field in it, and a test poisons a real engine venue to prove the adapter strips
it.

`lib/active-plan.ts` persists it under **owner-scoped keys**
(`fl:active-plan:v1:<uid|anon>`). This repo shipped shared-browser bleed once
(PR #129); here the owner is in the key, so one account cannot read another's
night by construction rather than by remembering to clear.

## Compatibility

**No migration. No schema change. No pre-merge database step.**

- `toSavedSteps` still emits an **array** with the four legacy keys and adds
  `slug`. Rows written today stay readable by code that predates the model and
  by the account-data export (`app/(main)/profile/actions.ts`).
- `fromSavedRow` reads the six production rows written in the legacy shape,
  keeps the exact daypart inference `openSaved` used, and is honest about what
  it cannot recover: **vibe and budget are genuinely absent**, so they take the
  caller's current values and affect regeneration only.
- `public.plans` has SELECT/INSERT/DELETE and **no UPDATE**, so re-saving a
  reopened night is a new row. `savedRowId` records provenance; it never
  reaches the write path.

## Deliberate boundaries

- **The area control IS seeded**, as a neighbourhood, but only when
  `regionOf()` resolves the name. This reverses an earlier boundary: not
  guessing was defensible while nothing on a restored night could regenerate,
  but "Try another combination" now appears on every night, so declining to
  guess became the worse guess — reopening "A Lively Night in Shoreditch" and
  tapping it returned a night anywhere in London. An unmapped neighbourhood
  falls back to "anywhere", because the picker renders an unresolvable name as
  a highlighted chip labelled the literal word "Area", with no drill-down.
- **Per-stop swaps are available on EVERY night**, restored and reopened
  included. They used to be hidden on all of them, because
  `computed.alternatives[i]` is relative to a *generated* plan's other stops,
  so offering it against a night the engine did not just produce could build a
  route nobody can walk. That was engine work, not adapter work, and it is
  done: `alternativesFor(pool, stops, opts)` derives the options from the
  stops they belong to, and `computePlan` calls it too so the two cannot
  drift. The gate is now simply whether that stop has any options.
- **No night is read-only.** A reopened saved row is savable like any other —
  `plans` is insert-only, so a changed night saves as a NEW row, which is the
  honest semantics for that table. `alreadySaved` decides whether the button
  offers to save or reports that it already is, and it is disabled until the
  saved list has loaded, because guessing wrong writes a permanent duplicate.
- **`source` still matters.** It picks the freshness anchor, the
  `plan_origin` analytics dimension, and whether the vibe/budget controls are
  treated as this night's brief (a saved row has none, so its replacements
  are not filtered by them).

## Failure behaviour

- A stored night is dropped rather than restored once it is over. When the
  night knows when it happens (`startsAt`, and it was a chosen time), that is
  the authority — it is fresh until its own last stop is behind us, bounded
  forward so a hand-edited far-future stamp cannot make it immortal. A "right
  now" night has no chosen time — its stamp is just when Build was tapped, and
  the UI re-anchors it to the live clock on restore — so it falls back to
  `createdAt + NIGHT_PLAN_TTL_MS` (12h). Freshness and the display have to
  agree about when the night is, or a night renders as running and is then
  deleted minutes later for having ended.
- A night that loses stops to catalogue churn is **relinked** before render, so
  the survivors do not keep walk times measured to a venue that is gone, and
  `plan_restored_partial` fires.
- A night whose venues have all gone is cleared rather than retried forever.
