# Fun London — "70% → 100%" Build Plan

**Created:** 2026-05-30 (Saturday)
**Checkpoint:** Monday 2026-06-01, evening — review what shipped, what's
partial, what's left.
**Goal:** Convert the fake/cosmetic 30% into real, working product. Nothing
is being cut. Where a feature can't be 100% real in the time, we ship the
honest, working subset — never the fake version.

This plan turns the gaps from the 2026-05-30 audit into executable work.
Each Epic has: a plain-English goal, why it matters, concrete technical
steps (file-level), and acceptance criteria (how we know it's done).

---

## The 8 Epics (overview)

| # | Epic | What it fixes | Size | Day |
|---|---|---|---|---|
| A | Honesty & Trust cleanup | Fake "tables free", fake walk times, phantom bookings | S | Sat |
| D | Events tab finish | Close the in-progress task (filters + labels) | S | Sat |
| E | Real Search | The magnifying glass does nothing | S–M | Sat |
| H | Booking depth & polish | Dead "Add to calendar"/"Share"; no real booking producer | M | Sat→Sun |
| B | Plan My Night → real engine | Ignores vibe+budget; fake walk/time; doesn't save | L | Sun |
| C | Personalized "For You" | Default tab ignores the user's onboarding answers | M | Sun |
| F | Plan Together → real multiplayer | Entirely fake/scripted; no real second person | XL | Mon |
| G | Catalog growth | 19 venues; auto-scout adapters are all stubs | M | Mon |

S ≈ <2h · M ≈ 2–4h · L ≈ half-day · XL ≈ full-day

---

## EPIC A — Honesty & Trust cleanup  *(Saturday, do first)*

**Goal (plain English):** Stop showing numbers we made up. A booking app
loses trust the instant a user notices "5 tables free" is fiction. Remove
or relabel everything that pretends to be live data, and stop writing fake
booking records.

**Why first:** Fast, low-risk, and it protects credibility with the exact
testers we're onboarding right now.

**Steps:**
1. `app/venue/[slug]/venue-detail.tsx`
   - Remove the **"{tablesFree} tables free"** pill entirely (no live
     availability source exists).
   - Remove the static **"{walkingMins} min walk"** pill — it implies
     distance from the user, but there's no user location. (Real walk
     times return in Epic B, computed step-to-step inside a plan.)
   - Reserve CTA: the legacy fallback button reads `Reserve · {nextSlotLabel}`
     and routes to the fake in-app confirmation. Replace the fallback so
     that when a venue has **no `bookingLinks`**, it deep-links to
     `websiteUrl` (or shows phone) instead of the fake flow. Real catalog
     venues already deep-link correctly — keep that path untouched.
2. `app/booking/[slug]/confirmed/page.tsx` + `booking-recorder.tsx`
   - Stop writing **phantom bookings** (hardcoded party=2, ref `XXX-4912`,
     "Today"). Either delete the route or gate it behind a real,
     user-entered booking (handled properly in Epic H). For Saturday:
     remove the `BookingRecorder` DB write so no fictional rows are
     created. Leave the celebratory screen only if reached via Epic H.
3. `lib/queries.ts` / `lib/mock-data.ts` — audit any other surfaced
   "live-looking" number and confirm it's either real or removed.

**Acceptance:**
- No fabricated availability ("tables free") anywhere in the UI.
- No "X min walk" shown without a real computed distance.
- No `bookings` rows are created unless a user actually logs one.
- Every venue's Reserve action goes somewhere real (booking platform,
  the venue's own site, or phone) — never the fake confirmation.

---

## EPIC D — Events tab finish  *(Saturday — closes in-progress task #37)*

**Goal:** The event detail page is already built and on-brand. Finish the
last 10%: make the `/events` filters trustworthy and close the task.

**Steps:**
1. `app/(main)/events/events-feed.tsx` — verify the **date pills**
   (Tonight / This Weekend / This Week) and **category chips** filter the
   live event list correctly.
2. **Fix `date_label` staleness.** Today the bucket ("Tonight" etc.) is
   computed at *ingest* time and stored. Between cron runs it can drift
   (a "Tonight" event becomes tomorrow's). Switch the events feed to
   derive the bucket from `starts_at` **at read time** so it's always
   correct, regardless of when the cron last ran.
3. Confirm event cards link to `/event/[id]` and the detail CTA label is
   source-aware (currently hardcoded "Ticketmaster" — make it read from
   `event.source` so future Eventbrite/Skiddle events label correctly).
4. Mark task #37 complete.

**Acceptance:**
- Date/category filters return correct results against live DB.
- No stale "Tonight" labels on events that aren't tonight.
- Event card → detail → ticket link works end to end; CTA names the right
  provider.

---

## EPIC E — Real Search  *(Saturday)*

**Goal:** Make the magnifying glass work. Let users find a venue or event
by name, area, type, or vibe.

**Steps:**
1. New `components/search-overlay.tsx` (client): full-screen overlay with
   a text input and a live-filtered result list.
2. Filter logic (pure client — Explore already has all venues+events in
   memory; pass them in): match query against venue `name`,
   `neighbourhood`, `type`, `vibeTags`, and event `name`, `venueName`,
   `area`, `category`. Case-insensitive substring; rank exact/name matches
   first.
3. Wire the existing Search button in `explore-feed.tsx` to open the
   overlay (replace the `console.log` stub).
4. Result rows reuse the existing card styles; tapping navigates to
   `/venue/[slug]` or `/event/[id]`. Include an empty state and a
   "clear" affordance.

**Acceptance:**
- Typing "soho", "jazz", "wine", or a venue name returns relevant results
  instantly.
- Tapping a result navigates correctly.
- Works with zero results (friendly empty state) and is keyboard/escape
  dismissible.

---

## EPIC H — Booking depth & polish  *(Saturday spillover → Sunday)*

**Goal:** Make the booking-adjacent actions real, and give the app an
*honest* way to produce real bookings (since we deep-link out, the only
real reservation is the one the user makes — so let them log it).

**Steps:**
1. **Real "Add to calendar"** — generate a valid `.ics` (VEVENT) client-side
   from event/booking details and trigger a download (data URL / Blob).
   Wire it on the event detail and (Epic H step 3) the confirmation screen.
2. **Real "Share"** — use the Web Share API (`navigator.share`) with a
   graceful copy-link fallback. Wire on venue, event, and confirmation.
3. **Honest booking producer** — after a user taps a Reserve deep-link,
   show a lightweight "Did you book? Add it to your plans" prompt. If yes,
   capture party size + time and write a **real** `bookings` row they
   actually made. This is what feeds the "Coming up" section on `/saved`.
   Replaces the phantom-booking path removed in Epic A.

**Acceptance:**
- "Add to calendar" downloads a file that imports cleanly into Apple/Google
  Calendar with correct title/time/location.
- "Share" opens the native share sheet on mobile, copies a link on desktop.
- A user-logged booking appears in `/saved → Coming up`; no booking exists
  unless the user created it.

---

## EPIC B — Plan My Night → real engine  *(Sunday, half-day)*

**Goal:** The app's namesake feature must actually respond to the user.
Right now vibe and budget are ignored and the times are hardcoded. Make it
a real recommender.

**Steps:**
1. Recreate `lib/plan-engine.ts` (it was deleted in an earlier cleanup) and
   move the logic out of `plan-flow.tsx`.
2. **Use budget:** map `£ / ££ / Any` to allowed `PriceTier`s and filter
   the candidate pool (`Any` = no filter).
3. **Use vibe:** score each venue for fit:
   - `chill` → cafes/wine bars, higher rating, Day/Evening, calmer
     `moodTags`/`vibeTags`.
   - `lively` → bars/pubs/live music, Night, "lively"-ish tags.
   - `fancy` → higher price tier, Restaurant/Wine Bar, refined tags.
   - `unique` → less common types (Listening Bar, Live Music, Culture),
     distinctive `vibeTags`.
   Pick the best-fit venue for each slot: **Start** (eat) → **Then**
   (drink) → **Finish** (night/music), de-duplicating venues.
4. **Real walk times:** compute haversine distance between consecutive
   chosen venues using `lat`/`lng`, convert at ~12 min/km. Replace the
   hardcoded `6 + i*2` walk labels and the fake "~3.5 h total" (sum real
   step durations + walks). Handle missing coordinates with a clearly
   estimated fallback or hide the walk line for that gap.
5. **Regenerate:** add a "Try another combination" button that reshuffles
   within the same constraints (vary by a rotating offset so it's not
   identical each press).
6. **Save the plan:** "Save this night" writes to `public.plans` (table
   already exists) when signed in. Add `savePlan()` + `fetchPlans()` to
   `lib/queries.ts`; surface saved plans on `/plan` (or `/saved`).
   `plan/page.tsx` passes `authUserId`.

**Acceptance:**
- Changing **vibe** or **budget** visibly changes the resulting plan.
- Walk times differ based on actual venue distance; total time is computed,
  not fixed.
- "Try another" yields a different valid plan.
- A signed-in user can save a plan and re-open it later.

---

## EPIC C — Personalized "For You"  *(Sunday)*

**Goal:** Make the default Explore tab reflect the moods/vibes the user
chose at onboarding. The data is already stored (DB for signed-in,
localStorage for anon) — we just need to *use* it.

**Steps:**
1. `app/(main)/explore/page.tsx` — pass `profile.preferences` into
   `ExploreFeed` (server side, already fetched).
2. `explore-feed.tsx` — for anonymous users, read prefs from
   `localStorage["fl.onboarding.v1"]` on mount. Merge into a single
   `prefs` value.
3. **Ranking helper** (`lib/ranking.ts`): in the "For You" filter, sort
   venues so those whose `moodTags` intersect the user's `moods` rank
   first; tie-break by vibe match and rating. Rank events by category
   match (e.g. `culture`→Music, `activity`→Comedy, `dinner`→Food). No prefs
   → fall back to today's concat (unchanged).
4. Light UI signal: a subtle "Picked for you" eyebrow or a reason chip
   ("because you like live music") on boosted items — optional, only if
   time allows.

**Acceptance:**
- A user who picked "Live Music + lively" sees music venues/events first
  in "For You".
- Anonymous user with localStorage prefs gets the same treatment.
- No prefs set → behaves exactly as today (no regression).

---

## EPIC F — Plan Together → real multiplayer  *(Monday, full day)*

**Goal:** Replace the scripted fake with genuine multiplayer using Supabase
Realtime. Two real people on two devices join the same room, see each
other, swipe, and get a shared result.

**Approach (fastest *real* path): Supabase Realtime Broadcast + Presence —
no new tables required for v1.**

**Steps:**
1. New `lib/realtime/room.ts` — a `useRoom(code)` hook over Supabase
   Realtime:
   - **Presence** → who's in the lobby (name + avatar color), live
     join/leave.
   - **Broadcast** → swipe votes and phase changes.
2. **Create / Join:** host creates a room → short code + shareable link
   (`/plan/together?room=ABCD`). Others open the link or enter the code.
   Anonymous-friendly: assign an anon id + display name + color on join.
3. Rewrite `_steps/lobby.tsx` to show **real** presence (remove timed fake
   joins). `_steps/swipe.tsx` broadcasts each vote. `_steps/mixing.tsx`
   waits for all present members to finish. `_steps/result.tsx` aggregates
   **real** votes (true vote attribution).
4. Edge cases: someone leaves mid-session, late joiner, host disconnect.
   Keep it forgiving (host's tally is source of truth).
5. **(Optional persistence, only if time):** add `plan_rooms` /
   `plan_room_votes` tables + RLS to survive refresh. Not required for the
   live demo.

**Honest fallback if the day runs short:** ship the **real lobby**
(create/join + live presence over a shared link) and label the swipe/result
as "beta" — still genuinely multiplayer, never the scripted fake.

**Acceptance:**
- Two browsers/phones open the same room link and see each other appear
  live in the lobby.
- Swipes from both show up; the result reflects the actual combined votes.
- No scripted/fake participants anywhere in the flow.

---

## EPIC G — Catalog growth  *(Monday, parallel / if F finishes early)*

**Goal:** More venues and the first real auto-discovery source, so the
catalog stops being entirely hand-built.

**Steps:**
1. **Wire the Time Out adapter** (`scripts/candidate-sources/timeout.ts`):
   parse Time Out London's RSS/listing into venue *mentions* (name + url +
   date). No API key needed. Run `pnpm scout-candidates:dry` then live →
   populates `public.pending_candidates`.
2. Review the queue at `/admin/candidates`; approve a couple to prove the
   end-to-end scout → review → ingest loop.
3. **Add 6–10 venues** by hand via `scripts/venues-seed.ts` + `pnpm ingest`
   (broaden areas/types — more "Best of London" coverage).
4. **(Optional)** add 1–2 more Ticketmaster event subscriptions for
   curated venues that have real upcoming events.

**Acceptance:**
- Time Out adapter returns ≥1 real mention; scout surfaces ≥1 multi-source
  candidate in the admin queue.
- Catalog grows to ~25–29 venues, all images loading, no chains.

---

## Day-by-day schedule

**Saturday (today) — Honesty + quick wins**
- A — Honesty & Trust cleanup
- D — Events tab finish (close #37)
- E — Real Search
- H (part) — ICS calendar + Web Share
- End of day: `pnpm check`, commit, push each; update STATE.md.

**Sunday — Intelligence**
- B — Plan My Night real engine + save plans
- C — Personalized "For You"
- H (part) — honest self-logged bookings → "Coming up"
- End of day: `pnpm check`, commit, push; update STATE.md.

**Monday — Multiplayer + catalog, then review**
- F — Plan Together realtime (most of the day)
- G — Catalog growth (parallel / fallback if F lands early)
- **Monday evening:** run the review checklist below; decide what remains.

---

## Cross-cutting rules (every Epic)
- Tailwind + theme tokens only; server-first components; mock data only via
  `lib/mock-data.ts`. (House rules.)
- Run **`pnpm check`** (typecheck + lint + format) before every commit.
- Only official/legal provider APIs — never scraping that risks a partner
  relationship.
- Commit per Epic with a clear message; push; update `STATE.md`.

## Dependencies & risks
- **F (Plan Together)** is the biggest and riskiest — Monday is reserved for
  it, with the real-lobby fallback if needed.
- **B walk times** depend on `lat`/`lng` being present (nullable) — handle
  missing coordinates gracefully.
- **No external homework blocks A–F.** Realtime is already available;
  onboarding prefs already persist. Epic G's Time Out adapter needs no key.
- Personalization is subtle at 19 venues — Epic G helps it feel real.

---

## Monday-evening review checklist
For each Epic, mark **Done / Partial / Cut** and check acceptance:
- [ ] A — no fake numbers, no phantom bookings
- [ ] D — events filters correct, labels not stale, #37 closed
- [ ] E — search returns and navigates
- [ ] H — calendar + share real; honest booking producer
- [ ] B — vibe+budget change the plan; real walk times; save works
- [ ] C — For You reflects onboarding prefs
- [ ] F — two real devices share a live room (or real-lobby beta)
- [ ] G — first auto-scout candidate + catalog grown

Then: list what's still missing and decide the next sprint.
