# Fun London — State Snapshot

## ✅ Custom domain DONE (2026-06-01 eve) — both addresses live
- **`www.funldn.com`** ✅ serves the full app (verified). **The address to share.**
- **`funldn.com`** (bare) ✅ now **301-redirects → www.funldn.com** (verified via
  curl: 301 → location www → 200). Fixed with a Cloudflare **Redirect Rule**
  ("Redirect from root to WWW" template) — the Registrar Parking Page CNAME is
  locked/un-editable, so the redirect rule was the way around it. If the bare
  domain ever reverts to the parking placeholder, the rule is under Cloudflare →
  funldn.com → Rules → Redirect Rules.
- Domain bought via iCloud+, registered through **Cloudflare Registrar**
  (account `Mp.aranzales10@uniandes.edu.co`), pointed at Vercel project `fun-london`.
  iCloud email MX/DKIM records live in Cloudflare DNS — DO NOT TOUCH them.
- **Supabase auth URLs updated** to `https://www.funldn.com` (Site URL +
  `…/auth/callback` redirect) — per Maria; not machine-verifiable from here.

## ⏳ Still TODO (laptop, low priority)
  0. **Domain auto-renew is OFF** — turn ON in Cloudflare → Domains →
     Registrations → funldn.com (expires Jun 1 2027) so it doesn't lapse.
  2. **"Continue with Google" sign-in NEVER finished.** Needs the 3-console job:
     Google Cloud (OAuth consent screen → Publish or add test emails; create OAuth
     Web client with redirect `https://fxfuzabrivuianfwdopc.supabase.co/auth/v1/callback`)
     → paste Client ID/Secret into Supabase → Auth → Providers → Google → enable.
     DB shows 0 google-provider users → flow is unproven. Magic-link is the
     fallback that works without this.
  3. **Vercel Deployment Protection** — confirm OFF for the custom domain so
     testers reach it without an SSO wall (www currently loads fine, so likely OK).
- **Supabase Security Advisor (2026-06-01): 3 warnings** to harden before launch —
  2× SECURITY DEFINER on `public.pending_candidates_touch()` (Claude can fix in DB)
  + "Leaked Password Protection disabled" (one toggle in Auth settings).

**Last updated:** 2026-06-01 (mood-deck Phase A/B verified live in-browser;
time-of-day relabelled Morning/Afternoon/Night; discovery robot now hunts
day-spots + tuned for the free tier; chain detection fixed; catalog at
39 venues)
**Branch state:** Phases 1 + 2 + 3 + 3.5 + 4 + 4.5 + Stage 3 ingestion +
Batch 2 + Phase 5 Tiers 1/2/3 + Google sign-in + **Plan Together v2
(real multiplayer over Supabase Realtime)** + **mood swipe-deck** all
merged to `main` (HEAD `e2da7a0`) and live. **The catalog is real
(39 venues), self-maintaining, AND auto-growing via the discovery robot.**

## What's new since 2026-05-28 (the 2026-05-30/31 work)

- **Autonomous discovery robot LIVE** (`scripts/discover-venues.ts` +
  `.github/workflows/discover-venues.yml`, every 4h, all-Google + free).
  Google Places finds candidates → location-count chain filter → Gemini
  2.5 Flash does BOTH 2-source validation (built-in Google Search) AND the
  brat editorial → loops to 10 compliant → auto-publishes. Grew the catalog
  19 → **27** (last batch: Bermondsey + Peckham). Confirmed green
  2026-05-31. Google Custom Search was abandoned (org-policy/billing) — do
  NOT go back to it; `GOOGLE_SEARCH_*` env vars are now unused.
- **Plan Together v2 — real multiplayer** (`lib/realtime/room.ts`):
  ephemeral Supabase Realtime room (Presence + Broadcast, no DB tables),
  proximity-first **walkable** plan engine (`computeWalkablePlan`), host
  settings (calendar date-picker + region chips incl. West/North), per-stop
  Swap, and a "Try a different mix" whole-plan reshuffle.
- **Mood swipe-deck** (`lib/plan-together-moods.ts`): the swipe step is a
  deck of *mood* cards that changes by time of day (Morning / Afternoon /
  Night); each hearted mood feeds the planner a per-role venue-type intent
  (`RoleIntent` / `roleMatchesIntent` in `lib/plan-engine.ts`) so the night
  matches the mood (cosy wine → a wine bar). **Verified live end-to-end
  (2026-06-01):** lobby → settings → swipe the Night deck → walkable 3-stop
  result (Sabor → The French House → Ronnie Scott's) + "try a different mix".
  **Done 2026-06-01 (closed out Phase C):**
  (1) settings time-of-day chips relabelled Day/Evening/Night →
  **Morning / Afternoon / Night** (hours 10/14/20; `deckTimeFromTimeOfDay`
  now maps 1:1 with a Night default for "now" rooms; `PlanWhen.timeOfDay`
  union updated in `room.ts`).
  (2) discovery robot (`scripts/discover-venues.ts`) now also hunts
  **Culture / Market / Outdoors** day-spots — lenient day-type gates (no
  chain check, review bar 150, website optional, Outdoors needs 1 source
  not 2, +Londonist / Secret London as trusted day-spot sources). The
  Morning/Afternoon decks will fill as the 4-hourly cron publishes day-spots;
  until then they show thin (graceful — `pickQuestionVenues` falls back).
  Also fixed a **dev-only React StrictMode bug** in `together-flow.tsx` where
  the room creator was misread as a guest (init now runs once via a guard).

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
• **Phase 5 Tier 2 (scaffolded, 2026-05-28)** — **Candidate scout foundation.**
  New `public.pending_candidates` table (provenance + AI-drafted
  editorial + filter audit trail + status workflow). RLS-locked: no
  policies, service-role only. `/admin/candidates` Server Component
  route gated to admin emails (`FL_ADMIN_EMAILS` env, defaults to
  Maria's Gmail) — renders the queue, decision via Server Actions
  (approve / snooze 6mo / reject), revalidates on submit.
  `scripts/scout-candidates.ts` is the orchestrator (6 publication
  adapters in parallel → normalise → group by name → require ≥2
  distinct publications → dedupe vs public.venues → upsert). Six
  publication stubs in `scripts/candidate-sources/` (Time Out / Eater
  / Infatuation / Hot Dinners / Square Mile / Harden's) all return
  empty for now — each has a docstring noting which RSS / scrape
  pattern to wire. Chain detection via Google Places count heuristic
  is stubbed (returns 0). Dry-run `pnpm scout-candidates:dry` runs
  cleanly: "0 mentions → 0 multi-source candidates" with a friendly
  "expected — adapters are stubs" message.
  **Blocked on:** the publication adapters need to be wired one by
  one (Time Out RSS first — easiest). No external API keys required;
  it's just scraping/RSS work.
• **Phase 5 Tier 3 (autonomous + producing real events, 2026-05-29 evening)** —
  **Events pipeline.** First real adapter (Ticketmaster Discovery API)
  wired end-to-end, first real subscription (Ronnie Scott's, venue id
  `KovZ9177Jn0`) registered, and 2 real events live in `public.events`.
  Cron now runs every 4 hours autonomously and produces output that
  flows directly to the Events page. First CI run with the real
  adapter: success.
  `public.events` extended with `source`, `source_id`, `source_url`,
  `description`, `last_synced_at`, `sold_out`, `cancelled_at`, plus a
  unique (`source`, `source_id`) constraint for idempotent upserts.
  Original 5 demo events were `source='manual'` until 2026-05-29
  when they were deleted from production + `supabase/seed.sql` (now
  the events table is real-data-only).
  `scripts/events-seed.ts` defines the `EventSubscription` discriminated
  union (eventbrite / ticketmaster / skiddle / dice) — per-venue feed
  subscriptions, not individual events.
  `scripts/ingest-events.ts` is the orchestrator — complete: walks the
  seed, resolves venue_id + neighbourhood + img_url by slug, calls
  per-provider adapters in series, upserts via `ON CONFLICT
  (source, source_id)` with venue-image fallback + a dynamic
  `date_label` computed each run (Tonight / This Weekend / This Week),
  then runs a cancellation pass marking `cancelled_at` on any future
  event the provider dropped from its response (skips cancellation
  when fetched count is 0 — an empty response could be transient).
  `.github/workflows/events-ingest.yml` runs the script every 4 hours
  (00:30 / 04:30 / 08:30 / 12:30 / 16:30 / 20:30 UTC). Node 22
  override (same Supabase realtime / WebSocket reason as
  maintenance.yml). Provider API key secrets pre-wired
  (EVENTBRITE_PRIVATE_TOKEN / TICKETMASTER_API_KEY / SKIDDLE_API_KEY).
  First manual CI run: success.
  Provider adapters are STUBS (return empty arrays) until each API
  key lands — Maria's next homework is signing up at Eventbrite
  Developer (recommended first), Ticketmaster Developer Portal, and
  Skiddle Developer. DICE has no public API; deferred. Once any one
  key + a subscription is in place, real events start flowing on the
  very next cron tick — no further infrastructure work needed.
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

## The 27 real venues live in production

Manually curated (Batches 1–2) + auto-discovered by the robot (the
Bermondsey/Peckham additions). All have `google_place_id IS NOT NULL`.

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
| peckham-levels | Peckham Levels | Peckham | Bar | 4.4 |
| old-nunshead | The Old Nun's Head | Peckham | Pub | 4.5 |
| flour-and-grape | Flour & Grape | Bermondsey | Restaurant | 4.5 |
| pique-nique | Pique-Nique | Bermondsey | Restaurant | 4.4 |
| great-exhibition | Great Exhibition | Peckham | Pub | 4.5 |
| the-victoria-inn | The Victoria Inn | Peckham | Pub | 4.4 |
| casse-cro-te | Casse-Croûte | Bermondsey | Restaurant | 4.7 |
| jos | José | Bermondsey | Restaurant | 4.4 |

All 27 are also rows in `public.partner_prospects` (BD pipeline —
owner-managed without OpenTable/Resy, perfect partner targets). The
original demo venues (Bao Soho, Dishoom, etc.) remain in the DB so
saved/bookings FKs stay valid, but `fetchVenues()` filters to
`google_place_id IS NOT NULL` so they're hidden from the catalog.

**Type distribution (2026-06-01, 39 venues live):**
13 Restaurants · 5 Pubs · 4 Culture · 4 Bars · 3 Wine Bars · 3 Markets ·
3 Outdoors · 2 Live Music · 2 Cafes. (Count is the live DB, not the seed
file — the robot adds beyond the 29-row seed.)
**Day-spots seeded 2026-06-01** — 10 hand-curated, manually-validated
(by Claude via web search, NOT Gemini) Culture/Market/Outdoors venues added
via `scripts/venues-seed.ts` + `pnpm ingest` to fill the mood-deck's
Morning/Afternoon decks: Sir John Soane's Museum, Dennis Severs' House,
Whitechapel Gallery, Estorick Collection (Culture); Columbia Road Flower
Market, Netil Market, Maltby Street Market (Market); Walthamstow Wetlands,
Crossbones Garden, Brockwell Lido (Outdoors). All `skipProspect:true` (not
booking-partner targets, so partner_prospects stays at the 19 food/drink
venues). Afternoon deck verified live (long lunch → Whitechapel Gallery →
Crossbones Garden). Day-spots are still sparse per-area, so walkable
clustering is loose until the robot adds more.

**Discovery robot — chain fix + free-tier tuning (2026-06-01).** Three
changes after Maria caught a chain in the catalog and asked why the robot
only banks a handful/day:
- **Chain detection fixed** (`londonLocationCount`): it searched the venue's
  FULL Google name ("Be At One - Farringdon London") which returns only that
  one outlet, so 15-branch chains read as 1-location indies. Now strips the
  branch suffix to the BRAND ("be at one"), searches that, counts branches;
  threshold 6 → 4. Verified live: "be at one" → 15 (rejected); Brawn/40
  Maltby/Dishoom/Soane's all stay clean. The already-published **Be At One
  Farringdon row was deleted from the DB** (catalog 40 → 39).
- **Gemini calls 3 → 1 per venue:** editorial is now TEMPLATED from the
  venue + its validated sources (no AI call); the dead booking-link AI call
  was removed; only the 2-source validation call remains. Templated blurbs
  are honest-but-plain — richer "brat" editorial can layer back on with paid
  Gemini or a hand pass.
- **Per-run target 10 → 3** + **throttle (≥4.5s gap) & retry on 429/503**
  (`geminiFetch`). The cron fires 6×/4h; small target + pacing lets venues
  trickle through the day instead of one run draining the free DAILY quota
  and the rest 429ing (root cause of "only 3 all day"). NOTE: the free
  *daily* cap is the real ceiling — the genuine throughput unlock is
  pay-as-you-go Gemini **Flash** (cents, NOT Pro), deferred until launch per
  Maria. Verify tomorrow's first cron run on fresh quota.

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
- **Maintenance cron (Tier 1):** `.github/workflows/maintenance.yml`
  runs daily at 03:00 UTC (≈ 04:00 BST London). Re-pulls Google
  Places + dead-link scan + closure detection. Manual trigger via the
  Actions tab. Secrets live in GitHub Actions secrets (not Vercel):
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_PLACES_API_KEY`.
- **Events cron (Tier 3):** `.github/workflows/events-ingest.yml` runs
  every 4 hours at :30 past (00:30 / 04:30 / 08:30 / 12:30 / 16:30 /
  20:30 UTC). Calls the same script as `pnpm ingest-events`. Same
  Supabase secrets plus provider-specific (`EVENTBRITE_PRIVATE_TOKEN`,
  `TICKETMASTER_API_KEY`, `SKIDDLE_API_KEY` — empty until each is
  signed-up for). Provider adapters are still stubs; cron exits
  cleanly with "0 subscriptions" until the first one is wired.
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
| Events (real-only, currently 2 via Ticketmaster) | Supabase `public.events`, ingested by `scripts/ingest-events.ts` on a 4-hourly cron | `lib/queries.ts → fetchEvents` |
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

- **No `favicon.ico`.** App Router serves `app/icon.png` (1024×1024
  square) and `app/apple-icon.png` instead. Modern browsers handle this.
- **Tailwind spacing scale extended** with `4.5` / `5.5` / `6.5` in
  `tailwind.config.ts` because the codebase already used those classes
  (`bottom-4.5`, `pb-5.5`) and they were silently failing.
- **In-app theme is time-based, iOS chrome is OS-theme-based.** As of
  2026-05-28, `viewport.themeColor` adapts to `prefers-color-scheme`
  (cream on light, near-black on dark), so the iOS Safari status-bar
  tint reads correctly at install time before the JS theme provider
  mounts. The in-app body still flips at 18:00 / 06:00 via the
  ThemeProvider — so a user at night with their OS in light mode will
  see a cream chrome bar above a dark app body. Acceptable trade.

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

*(none)* — the `@unused` mock-data scaffolds and the orphan white-logo
asset that earlier versions of this section called out have all been
cleaned up. Current cleanliness audit (2026-05-28): 0 TODO/FIXME, 0
untracked files, 0 orphan assets, 0 unused exports flagged.
