# Fun London — State Snapshot

**Last updated:** 2026-05-28 (Google sign-in live + Phase 5 Tier 1 + Batch 2)
**Branch state:** Phases 1 + 2 + 3 + 3.5 + 4 + 4.5 + Stage 3 ingestion +
Batch 2 (8 new venues) + Phase 5 Tier 1 (autonomous maintenance) +
Google sign-in (OAuth, primary alongside magic-link) all merged to
`main` and live in production. **The catalog is real, self-maintaining,
and signing in via Google works.**

• **Phase 1** — catalog reads from Supabase via Server Components in
  `lib/queries.ts`.
• **Phase 2** — magic-link sign-in (`/sign-in` + `/auth/callback`),
  session-refresh middleware, auth-optional model.
• **Phase 3** — `useSaved` + `useBookings` dual-mode (localStorage anon,
  DB authed) with one-time slug→uuid migration on first sign-in.
• **Phase 3.5** — profile `display_name` + `preferences` from
  `public.profiles` via `fetchProfile()`. Includes name-at-sign-in.
• **Phase 4** (2026-05-27 AM) — venues schema extended for real
  ingestion: `google_place_id`, `booking_links`, `website_url`, `phone`,
  `instagram_handle`, `editorial_sources`.
• **Phase 4.5** (2026-05-27 evening) — added `creator_coverage` +
  `critical_flags` on venues, plus a separate `public.partner_prospects`
  table (internal BD overlay, locked via RLS — no anon access).
• **Stage 3** (2026-05-27 evening) — **11 real London venues ingested**
  via `scripts/ingest-venues.ts` calling Google Places API. All have
  real photos, addresses, ratings, editorial sources, creator coverage,
  Real Talk flags, and deep-link Reserve buttons.
• **Batch 2** (2026-05-28) — **+8 new venues bringing the catalog to 19.**
  Intentionally diversified: 2 pubs (Marksman, French House), 2 live-
  music venues (Ronnie Scott's, Cafe OTO), 1 cafe (Dusty Knuckle), 3
  wine bars (Brawn, 40 Maltby Street, Forza Wine Peckham). First time
  the catalog has used the `Pub`, `Wine Bar`, and `Live Music` types.
  Geographic expansion: Hackney, Dalston, Columbia Road, Bermondsey,
  Peckham. Ronnie Scott's required an in-place `UPDATE` to bind its
  demo-row UUID to the real Google place_id before the ingest could
  upsert (preserved any saved/booking FKs).
• **Phase 5 Tier 1** (2026-05-28) — **Daily autonomous maintenance.**
  `scripts/refresh-venues.ts` runs every day at 03:00 UTC via
  `.github/workflows/maintenance.yml`. Re-pulls Google Places for all
  venues with `google_place_id`, diffs against the DB, applies
  updates (rating, photo, address, businessStatus, websiteUri,
  phone). Closure detection writes `venues.closed_at` once — alert
  flag for Maria's review, NOT auto-hide. Dead-link checker scans
  every `editorial_sources` + `creator_coverage` URL, classifies
  into "real dead" (HTTP 404/410/400 from cooperative hosts) vs
  "bot-blocked / FYI" (403, timeouts, known anti-bot hosts like
  Square Meal / Jancis / Substack). First steady-state: 1 real dead
  link surfaced (Padella's Hot Dinners URL, genuine 404 — Hot
  Dinners renamed the page). Workflow runs on Node 22 (overrides
  `.nvmrc`'s Node 20 pin because Supabase realtime requires native
  WebSocket which arrived in Node 22).

What's still NOT in Supabase: Plan Together participants (static
demo data, no DB story).

Codebase: strict TS, clean ESLint, Prettier-enforced. `MOCK_USER` /
`getCurrentUser()` fully retired. `lib/mock-data.ts` has just
`MOCK_SAVED_IDS` + `MOCK_PARTICIPANTS`.

## The 19 real venues live in production

| Slug | Name | Area | Type | ★ |
|---|---|---|---|---|
| brat | Brat x Climpson's Arch | Shoreditch | Restaurant | 4.3 |
| st-john | St. John | Smithfield | Restaurant | 4.5 |
| quo-vadis | Quo Vadis | Soho | Restaurant | 4.4 |
| sessions-arts-club | Sessions Arts Club | Clerkenwell | Restaurant | 4.2 |
| sabor | Sabor | Mayfair | Restaurant | 4.6 |
| manteca | manteca | Shoreditch | Restaurant | 4.4 |
| quality-chop-house | The Quality Chop House | Farringdon | Restaurant | 4.6 |
| tayer-elementary | Tayēr + Elementary | Old Street | Bar | 4.4 |
| monmouth-coffee | Monmouth Coffee Company | Borough | Cafe | 4.5 |
| andrew-edmunds | Andrew Edmunds | Soho | Restaurant | 4.5 |
| padella | Padella Borough Market | Borough Market | Restaurant | 4.7 |
| the-marksman | Marksman | Hackney | Pub | 4.2 |
| the-french-house | The French House | Soho | Pub | 4.5 |
| ronnie-scotts | Ronnie Scott's | Soho | Live Music | 4.7 |
| cafe-oto | Cafe OTO | Dalston | Live Music | 4.6 |
| dusty-knuckle | The Dusty Knuckle Bakery | Dalston | Cafe | 4.6 |
| brawn | Brawn | Columbia Road | Wine Bar | 4.6 |
| 40-maltby-street | 40 Maltby Street | Bermondsey | Wine Bar | 4.7 |
| forza-wine-peckham | Forza Wine Peckham | Peckham | Wine Bar | 4.5 |

All 19 are also rows in `public.partner_prospects` (BD pipeline —
they're all owner-managed without OpenTable/Resy, perfect partner
targets). The original demo venues (Bao Soho, Dishoom, etc.) remain
in the DB so saved/bookings FKs stay valid, but `fetchVenues()` now
filters to `google_place_id IS NOT NULL` so they're hidden from the
user-facing catalog.

**Type / area distribution (Batch 2 closed the early gaps):**
9 Restaurants · 3 Wine Bars · 2 Pubs · 2 Live Music · 2 Cafes · 1 Bar.
14 venues are central (Soho / Shoreditch / Smithfield / Mayfair /
Clerkenwell / Borough / Farringdon / Old Street). 5 are east+south
(Hackney, Dalston x2, Columbia Road, Bermondsey, Peckham).

## Real Talk UI

`/venue/[slug]` surfaces three Phase 4.5 things prominently:
- **"REAL TALK / What to actually expect."** — `critical_flags` rendered
  with editorial pull-quote treatment (single accent rule, hairline
  dividers, italic body)
- **"Why this is here"** collapsible expandable — `editorial_sources`
  list + `creator_coverage` list with Mixed/Critical badges
- **Reserve button** deep-links to `booking_links[0]` (top priority) —
  the agent thesis V1; falls back to legacy stub for demo venues

This is a point-in-time snapshot. For contribution conventions see
[`CONTRIBUTING.md`](./CONTRIBUTING.md). For durable stack info see
[`README.md`](./README.md).

---

## Run the dev server

```bash
nvm use         # 20.16 (see .nvmrc)
pnpm install
pnpm dev
```

Opens at **http://localhost:3000**.

Before pushing, run **`pnpm check`** — runs typecheck + lint +
format:check in one shot.

**`.env.local` is now required** for the app to load any catalog data.
Two variables, copied from Supabase → Project Settings → API Keys:

```
NEXT_PUBLIC_SUPABASE_URL=https://fxfuzabrivuianfwdopc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…
NEXT_PUBLIC_SITE_URL=http://localhost:3000
GOOGLE_PLACES_API_KEY=AIza…              # server-only · used by ingest script + future re-sync
SUPABASE_SERVICE_ROLE_KEY=eyJ…           # local-only · NEVER set on Vercel · ingestion writes
```

Both `NEXT_PUBLIC_SUPABASE_*` values + `GOOGLE_PLACES_API_KEY` are
also set on Vercel (Production + Preview). The service-role key lives
**only** in local `.env.local` — it's the master key, used by the
ingestion script to write to `public.venues` and
`public.partner_prospects`.

---

## Deployment

- **GitHub:** [`mparanzales/fun-london`](https://github.com/mparanzales/fun-london) — branch `main`, in sync with `origin/main`.
- **Vercel (Production):** [`fun-london.vercel.app`](https://fun-london.vercel.app) — running on Supabase. **Still gated by Vercel Deployment Protection** (HTTP 401 to anyone not signed into Vercel SSO). Toggle off in Vercel → Settings → Deployment Protection when ready to share publicly.
- **CI:** `.github/workflows/check.yml` gates merges on `pnpm check`.
- **Maintenance cron:** `.github/workflows/maintenance.yml` runs daily at
  03:00 UTC (≈ 04:00 BST London). Re-pulls Google Places + dead-link
  scan + closure detection. Manual trigger via the Actions tab. Secrets
  live in GitHub Actions secrets (not Vercel): `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `GOOGLE_PLACES_API_KEY`.
- **Vercel env vars:** `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set for Production + Preview.
- **Supabase project:** `fun-london` (project id `fxfuzabrivuianfwdopc`), region eu-west-2 (London). Schema + 11-venue / 5-event seed loaded. Auth → Email provider enabled, magic-link redirect URLs configured for `localhost:3000` and `fun-london.vercel.app`.
- **Email sender:** built-in Supabase SMTP, rate-limited to ~3-4 emails/hour on free tier. Replace with Resend (or similar) before any kind of launch.

---

## Completed screens

| Route | What it does | Key files |
|---|---|---|
| `/` | Splash — fade-in/scale gradient wordmark, ~1.7s hold, then routes to `/onboarding` if `localStorage["fl.onboarding.v1"]` is absent, else `/explore` | `app/page.tsx` |
| `/onboarding` | 2-step quiz (Mood, Vibe). Hero gradient logo on step 0. Writes to `localStorage["fl.onboarding.v1"]`. | `app/(auth)/onboarding/{page,onboarding-flow}.tsx` |
| `/explore` | Personal greeting line ("Hi {name},"), editorial masthead ("today in / tonight in" + "fun London" wordmark), 6-chip filter row (For You / Eats / Bars / Cafés / Music / Events), unified vertical feed of venues and events | `app/(main)/explore/page.tsx`, `components/venue-card.tsx`, `components/event-card.tsx` |
| `/events` | "What's On" — date filter pills (Tonight / This Weekend / This Week) + category chips, list of event cards | `app/(main)/events/page.tsx` |
| `/saved` | "Your spots" — 2-col grid of saved venues with empty-state, fed by `useSaved()` context (localStorage-persisted) | `app/(main)/saved/page.tsx`, `components/saved-context.tsx` |
| `/plan` | Plan My Night — setup form (Area / Vibe / Budget) ↔ result (gradient header + 3-step itinerary with walk separators) + "Plan with friends" entry card | `app/(main)/plan/page.tsx`, `plan-flow.tsx`, `plan-together-card.tsx` |
| `/plan/together` | 4-step group flow: Lobby (timed friend join-ins) → Group Swipe (3 questions) → Mixing (auto-advance) → Result (vote attribution) | `together-flow.tsx` dispatcher + 5 files under `_steps/` |
| `/profile` | Avatar (display-name initial), display name, "spots saved" counter, preferences preview, 3 action rows | `app/(main)/profile/page.tsx` |
| `/venue/[slug]` | Full-bleed venue detail with hero, info, pills, sticky Save + Reserve CTA. Non-reservable types (Cafe / Culture / Market / Outdoors) swap Reserve for "No booking needed — walk in" | `app/venue/[slug]/{page,venue-detail}.tsx` |
| `/booking/[slug]/confirmed` | Booking confirmation — gradient hero, venue thumbnail, details (date / time / party / ref), stub Add-to-calendar + Share, Done | `app/booking/[slug]/confirmed/page.tsx` |

Bottom nav: Explore / Events / Plan / Saved / You (Profile). The Saved tab
badges the saved-venues count via `useSaved()`.

---

## Key design tokens

Defined in `app/globals.css` and surfaced via `tailwind.config.ts`:

| Token | Day | Night | Tailwind class |
|---|---|---|---|
| `--fl-bg` | `#f0eee9` (cream) | `#14110d` (near-black) | `bg-bg` |
| `--fl-fg` | `#2a2419` | `#ece6d9` | `text-fg` |
| `--fl-heading` | `#1a1409` | `#ffffff` | `text-heading` |
| `--fl-muted` | `#e6e2db` | `#2a2520` | `bg-muted` |
| `--fl-muted-fg` | `#756c5d` | `#9c9385` | `text-muted-fg` |
| `--fl-card` | `#ffffff` | `#1f1b15` | `bg-card` |
| `--fl-border` | `#e3ddd2` | `#2f2a22` | `border-border` |
| `--fl-primary` (brand purple) | `hsl(233 70% 55%)` | `hsl(233 80% 70%)` | `text-primary`, `bg-primary` |
| `--fl-accent` (purple, slightly redder) | `hsl(265 80% 60%)` | `hsl(265 80% 72%)` | `text-accent`, `bg-accent` |

**Font:** Plus Jakarta Sans (loaded via `next/font/google` in
`app/layout.tsx` with weights 400/500/600/700/800 and styles normal+italic).
One font family across the entire consumer app.

**Theme auto-switching:** `components/theme-provider.tsx` sets
`document.documentElement.dataset.theme` to `"night"` between 18:00 and
06:00, `"day"` otherwise. Runs every 60s after mount.

---

## Data layer (Phase 1 + 2 + 3 + 4 + 4.5 shipped)

| Source | Lives in | Read via |
|---|---|---|
| Venues (11 real, post-ingestion) | Supabase `public.venues` filtered to `google_place_id IS NOT NULL` | `lib/queries.ts → fetchVenues / fetchVenueBySlug / fetchVenueById` |
| Partner prospects (11 — internal BD overlay) | Supabase `public.partner_prospects` | RLS-locked, no anon access. Internal use only. |
| Venue ingestion | `scripts/venues-seed.ts` (editorial overrides) + `scripts/ingest-venues.ts` (Google Places fetch + dual-write) | `pnpm ingest` (or `pnpm ingest:dry`). Idempotent on `google_place_id`. |
| Events (5) | Supabase `public.events` | `lib/queries.ts → fetchEvents` |
| Saved set | anon: localStorage `fl.saved.v1` · authed: `public.saved_venues` | `components/saved-context.tsx → useSaved()` |
| Bookings | anon: localStorage `fl.bookings.v1` · authed: `public.bookings` | `components/bookings-context.tsx → useBookings()` |
| Auth user | Supabase Auth cookies (HTTPOnly) | `lib/auth.ts → getAuthUser()` |
| Profile display name + preferences | Supabase `public.profiles` | `lib/queries.ts → fetchProfile()` (Server Component) |
| Plan Together participants (4) | `MOCK_PARTICIPANTS` (static demo data, no DB story) | `lib/mock-data.ts → getParticipants()` |

**Slug-based references:** `useSaved` keys by `venue.slug` (e.g.
`"padella"`), not `venue.id` (Supabase uuid). Slugs are stable across
reseeds; uuids are not. The Phase 3 sign-in migration resolves
slug → uuid at the moment of moving local rows into
`public.saved_venues` / `public.bookings`.

**One-time local→DB migration** runs in the SavedProvider /
BookingsProvider whenever they mount with `authUserId` set AND
localStorage still holds rows. FK-safe (unknown slugs are dropped),
idempotent (upsert on the PK), and local data is cleared only after
a successful insert.

**Venue overlap on Explore.** The "For You" filter concatenates every
venue + every event. Padella, Dishoom, and Bao all qualify as evening
Restaurants and appear in multiple ordered chip filters. Mirrors the
prototype's overlap; not a bug.

---

## Auth model — Auth Optional

- **Middleware on.** `middleware.ts` matcher runs on every non-static
  request. `lib/supabase/middleware.ts` ONLY refreshes the session
  cookie — it does NOT redirect anonymous users. Hard-gate logic was
  deliberately removed in Phase 2.
- **Routes that need a user check themselves.** `/profile` is the only
  one today; it's a Server Component that calls `getAuthUser()` and
  renders either an inline Sign In CTA or the existing profile UI.
- **Sign-in methods (both supported):**
  - **Google OAuth (primary, 2026-05-28).** "Continue with Google"
    on `/sign-in` calls `signInWithOAuth({ provider: 'google' })`
    with `prompt: select_account`. User picks their Google account →
    Supabase auth.v1/callback exchanges the code → app's
    `/auth/callback?code=…` lands them → redirect to `/explore`.
    Supabase auto-links to an existing email-magic-link account when
    the email matches (so the same user can sign in either way).
  - **Magic-link (still supported).** `/sign-in` form → email +
    optional display_name → `signInWithOtp` → link in inbox → click
    → same callback → redirect to `?return=` or `/explore`. PKCE
    flow under @supabase/ssr v0.5. Rate-limited to ~3-4 emails/hour
    on Supabase's built-in SMTP — Google sign-in is the launch-blocker
    workaround for that limit; custom SMTP is still pending if you
    want unlimited magic-link sends.
  - **Skip for now (tertiary).** Anonymous tap-through link at the
    bottom of `/sign-in` routes to `/explore`. The whole app works
    anonymously via localStorage (saved venues + bookings); a later
    sign-in migrates the local data to Supabase via the Phase 3
    one-time sync.
- **Display-name backfill.** `/auth/callback` picks the first
  non-empty value from `user_metadata.display_name` (set by the
  magic-link form), `full_name` (Google), or `name` (Google
  alternative) and writes it to `public.profiles.display_name` —
  but only if no explicit name was already set there.
- **Sign-out:** `/profile` includes a "Sign out" action row that calls
  `supabase.auth.signOut()` and `router.refresh()` to drop back to the
  anonymous view.
- **First-time users:** the schema's `on_auth_user_created` trigger
  auto-inserts a row into `public.profiles` with `onboarded=false`.
  Phase 3 will wire `/onboarding` to flip `onboarded` true + write
  `preferences`.

## Known config caveats

- **No `public/manifest.json`** despite `app/layout.tsx` referencing
  `manifest: "/manifest.json"` — harmless 404 in dev. PWA manifest is a
  forward-looking item.
- **No `favicon.ico`.** App Router serves `app/icon.png` (1024×1024
  square) and `app/apple-icon.png` instead. Modern browsers handle this.
- **`themeColor: "#f0eee9"`** in `app/layout.tsx` is hardcoded to day
  cream. iOS chrome bar won't adapt to night theme. P3 follow-up.
- **Tailwind spacing scale extended** with `4.5` / `5.5` / `6.5` in
  `tailwind.config.ts` because the codebase already used those classes
  (`bottom-4.5`, `pb-5.5`) and they were silently failing.

---

## What's pending

In rough priority order:

1. **Business model deep-think** — coach feedback from 2026-05-27.
   Revenue mix between consumer freemium, partner commissions, partner
   subscriptions. Maria will tackle this strategically; not blocking.
2. **Custom SMTP for auth emails** — wire Resend (or similar) so the
   ~3-4/hour rate limit on Supabase's built-in email service stops
   being a launch blocker.
3. **More venues** — workflow now established: append an entry to
   `scripts/venues-seed.ts` with the editorial overrides + a Google
   Places search query, then `pnpm ingest`. The script handles the
   rest (Google Places fetch, dual-write to venues + partner_prospects).
   ~2 min per venue.
4. **Vercel Deployment Protection off** — toggle when ready to share
   publicly with non-Vercel-SSO users.
5. **Real events** — same pattern as venues but for `public.events`.
   Sources: Eventbrite + Ticketmaster Discovery + DICE + Skiddle.
   Sprint 5 work; not yet started.
6. **Splash respects DB onboarded status** — currently `app/page.tsx`
   routes based on localStorage only. Cross-device sign-in re-prompts
   onboarding because the new device has no `fl.onboarding.v1`. Make
   splash a Server Component that prefers `profile.onboarded` when
   signed in.
7. **"Trending" / "Hidden classics" filter chips** — concept floated
   during curation: split venues into trending (Manteca, Brat, QCH,
   Sabor, Sessions) vs hidden classics (Quo Vadis, Andrew Edmunds,
   Tayer + Elementary). Sprint 5+ idea.
8. **Photo handling V2** — currently Google Places photo URLs include
   an inline API key. Eventually: download + reupload to Supabase
   Storage for clean public URLs.
9. **V2 booking-aggregator** — store every venue's booking links
   (multi-platform) and eventually query real-time availability across
   OpenTable / Resy / SevenRooms / venue site. V1 deep-links to one.
10. **Stripe Connect for partners** — partner-side payments. Partner
   dashboard prototype lives in `project/_design-handoff/Partner
   Dashboard.html` (not in this Next.js app yet).
11. **PWA manifest** — referenced in `app/layout.tsx` but file
   doesn't exist; harmless 404 in dev.

---

## Recent cleanup (audit results, 2026-05-15)

### Files deleted (confirmed dead)

- `components/ui/button.tsx` — Button never imported by any consumer
- `components/ui/primitives.tsx` — Card, Pill, SectionHeading never used
- `components/ui/` directory removed (empty)
- `lib/plan-engine.ts` — `generatePlan` superseded by inline
  `computePlan` in `app/(main)/plan/plan-flow.tsx`
- `formatPrice` function in `lib/utils.ts`

### Files refactored

- `app/(main)/plan/together/together-flow.tsx` (was 772 LOC) — split
  into:
  - `together-flow.tsx` (~25 LOC step dispatcher)
  - `_steps/lobby.tsx` / `swipe.tsx` / `mixing.tsx` / `result.tsx`
  - `_steps/avatar.tsx` (shared primitive)
- `app/(main)/plan/plan-flow.tsx` and
  `app/(main)/plan/plan-together-card.tsx` and all `_steps/*` — every
  page-background inline style migrated to Tailwind classes
- `app/(main)/plan/together/together-flow.tsx` — moved
  `getParticipants()` from module top level into each component (so
  the async Supabase swap won't break)

### Files added

- `.prettierrc` + `.prettierignore` — Prettier 3.8.3
- `.editorconfig`
- `.nvmrc` — Node 20.16
- `CONTRIBUTING.md` — contribution conventions

### Schema updated

- `supabase/schema.sql` v2 — renamed `places` → `venues`,
  `saved_places` → `saved_venues`, added all new Venue columns
  (`long_description`, `review_count`, `walking_mins`, `tables_free`,
  `next_slot_label`, `address`, `lat`, `lng`), added `bookings` table.

### Scripts added to package.json

- `pnpm format` / `pnpm format:check` — Prettier
- **`pnpm check`** — combined typecheck + lint + format:check gate
- `pnpm clean` — clears `.next` / `.turbo` / Node cache

---

## Audit metrics — current state

| Metric | Value |
|---|---|
| Total source LOC | ~3,550 (was 3,622; net -72 from cleanup) |
| Files in `app/` | 22 (was 18; +5 step files, -1 deleted) |
| Files in `components/` | 7 (was 9; -2 deleted from `ui/`) |
| Files in `lib/` | 7 (was 8; -1 deleted) |
| Largest single file | `lib/mock-data.ts` at 460 LOC (was `together-flow.tsx` at 772) |
| Inline style usage | Only legitimately-dynamic cases (gradient strips, participant colors, status LED green) |
| TypeScript `any` | 0 |
| Hardcoded secrets | 0 |
| Plain `<img>` tags | 0 |

---

## Files flagged for future review

**Forward-looking but currently unused** (kept with `@unused` JSDoc):

- `MOCK_BOOKINGS`, `MOCK_SAVED_VENUES`, `getVenueById`,
  `getSavedVenueIds`, `getNeighbourhoods` (all in `lib/mock-data.ts`)
- Types `Booking`, `BookingStatus`, `SavedVenue`, `TimeOfDay` in
  `lib/types.ts`

These are scaffolding for the partner side / future flows. The
`@unused` JSDoc explains intent so future devs don't bulk-delete.

**Orphan asset:** `public/logo-fun-white heart.png` (1.3 MB, dated Feb
24). Old square white-logo backup before the tight-crop re-export. Not
referenced.
