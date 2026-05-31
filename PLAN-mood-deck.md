# Plan Together — Mood Swipe-Deck (build plan)

> **CURRENT STATUS (2026-05-31, mid-build):**
> - ✅ **Phase B engine DONE + verified** (`lib/plan-engine.ts`, uncommitted in
>   working tree). Added `RoleIntent` type + `roleMatchesIntent()`; threaded an
>   `intent: RoleIntent = EMPTY_INTENT` param into `computeWalkablePlan` and
>   `buildClusterFromSeed`; swapped the 3 Plan-Together `roleMatches` call sites
>   (now lines ~431/481/537) to `roleMatchesIntent`. The SOLO `computePlan`
>   path (line ~227) still uses plain `roleMatches` — intentionally untouched.
>   `tsc --noEmit` passes. Back-compatible: behaves identically until a caller
>   passes a non-empty intent.
> - ✅ **`lib/plan-together-moods.ts` DONE + verified** (untracked). Mood type,
>   DECKS per Morning/Afternoon/Night, `deckTimeFromTimeOfDay`,
>   `intentFromHeartedMoods`, `ROLE_ORDER`. typecheck/lint/format all green.
> - ⏳ **Phase A UI NOT YET DONE.** Still to do: rewrite `swipe.tsx` to render
>   `DECKS[deckTimeFromTimeOfDay(room.settings?.when.timeOfDay)]` one mood card
>   at a time (keep ♥/✕, vote per mood index); make `together-flow.tsx`
>   `pickQuestionVenues` deck-aware (one photo per mood, graceful empties);
>   rewrite `result.tsx` `includedRoles` to pool hearted moods → build intent
>   via `intentFromHeartedMoods` and pass it as the 6th arg to
>   `computeWalkablePlan`; derive STEP_WORD/attribution from hearted moods.
> - ⚠️ The working tree also has SUPERSEDED brat-copy edits in `swipe.tsx`
>   (old 3-card `SWIPE_QUESTIONS`) + `result.tsx` (`STEP_WORD`). These get
>   overwritten by Phase A — do NOT commit them separately.
> - **Paused because:** the session's tool channel started garbling file reads,
>   making blind edits of `result.tsx` unsafe. Resume Phase A in a healthy
>   session; verify live (swipe a Night plan) before committing the whole deck
>   as one coherent commit.



**Decided with Maria 2026-05-31.** Replaces the 3 yes/no swipe cards
(Dinner?/Drinks?/Late night?) with a **mood swipe-deck**: same single-card
swipe gesture, but every card is a *vibe*, and the deck shown depends on the
group's **morning / afternoon / night** choice. Output stays the same: one
walkable 3-stop night with "try a different mix" + live vote attribution.

Mockup (read-only, workspace root, not in git): `../../plan-together-swipe-mockup.html`

## Guardrails (don't regress these)
- Keep the **Start → Then → Finish** 3-stop skeleton — it powers walk-times,
  dwell, ordering, the reshuffle, and group-sync.
- Keep `Vote = { memberId, qIdx, value }` so `lib/realtime/room.ts` broadcast is
  untouched. `qIdx` becomes the **mood-card index**.
- Tailwind-only, theme tokens only, server-first where possible (see
  CONTRIBUTING.md). Run the 3 gates separately (typecheck / lint / format) —
  the combined `pnpm check` OOM'd once.

## Catalog reality (live, 27 venues, 2026-05-31)
Restaurant 13 · Pub 5 · Wine Bar 3 · Bar 2 · Live Music 2 · Cafe 2 ·
**Culture 0 · Market 0 · Outdoors 0 · Listening Bar 0.**
→ Night deck is rich; morning/afternoon decks need day-venues (Phase C).

---

## Phase A — Mood-deck data + swipe UI
- [ ] New `lib/plan-together-moods.ts`: `Mood = { id, label, sub, emoji, role:
      PlanRole, types: VenueType[] }` and `DECKS: Record<TimeOfDay, Mood[]>`
      (Morning / Afternoon / Night) per the spec in `project_mood_deck_spec`.
- [ ] `swipe.tsx`: render the active deck (by `room.settings.when.timeOfDay`),
      one mood card at a time, stacked-deck visual, ♥/✕. Show the venue photo
      behind each card matched to the mood's types. Drop the old inline
      `SWIPE_QUESTIONS`.
- [ ] `together-flow.tsx`: `pickQuestionVenues` becomes deck-aware (one matching
      venue photo per mood, graceful fallback when a type is empty).
- [ ] `result.tsx`: attribution + `STEP_WORD` derive from the hearted moods, not
      the fixed dinner/drinks/late words.
- [ ] Graceful empties: a mood with no matching venue in the filtered pool is
      hidden from the deck (so morning/afternoon don't show dead cards today).
- **Acceptance:** swipe a Night plan end-to-end in the browser; result shows a
  walkable 3-stop night; "try a different mix" still works.

## Phase B — Engine: dynamic role → types
- [ ] `lib/plan-engine.ts`: replace hardcoded `EAT/DRINK/FINISH_TYPES` +
      `roleMatches` with an intent `Record<PlanRole, VenueType[]>` threaded into
      `computeWalkablePlan` / `buildClusterFromSeed`. Empty role → role dropped.
- [ ] `result.tsx` `includedRoles`: pool the group's hearted moods (yes ≥ no),
      bucket into Start/Then/Finish, union their `types` → the intent.
- [ ] Keep `variant` reshuffle + `swaps` working against the new intent.
- **Acceptance:** hearting only "cosy wine" yields a wine bar for the Then stop
      (not any bar); hearting "cocktails" yields a cocktail/Bar; mixed hearts
      union correctly. Typecheck/lint/format green.

## Phase C — Time-of-day relabel + day-venue catalog
- [ ] `settings.tsx` + `PlanWhen` union: relabel TOD to Morning / Afternoon /
      Night (hours ~10 / 14 / 20). Contained.
- [ ] Ingest a batch of **Culture / Market / Outdoors** venues (verifiable,
      independent, per the product thesis) so morning/afternoon decks fill out.
- [ ] Discovery-agent rebalance: target ~8–10 independent options **per vibe**
      ("center of gravity"); bias Places search slices toward under-filled
      vibes + day-types. (Pairs with discovery backlog #48 YouTube creators.)
- **Acceptance:** all three decks show real, sw’able venues with no dead cards.

---

## Also on the backlog (not part of this, tracked for sequencing)
- #48 YouTube creator coverage in the discovery pipeline (key works).
- #49 More event sources: Skiddle + Resident Advisor (DICE has no API).
- #51 Venue map + a proper desktop layout.
