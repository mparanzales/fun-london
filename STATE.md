# Fun London — State Snapshot

**Last updated:** 2026-05-26 (end of day, post Phase 1 + Phase 2)
**Branch state:** Supabase migration Phases 1 + 2 are merged to `main`
and live in production.

• **Phase 1** — the catalog (venues + events) reads from Supabase via
  Server Components. `lib/mock-data.ts` is no longer the source of
  truth for venues/events; user state (saved + bookings + profile
  prefs) still lives in localStorage / mock until Phase 3.
• **Phase 2** — magic-link sign-in is live. Anonymous browsing still
  works (Auth Optional model); `/profile` branches between anon
  (Sign in CTA) and authed (existing UI + Sign Out).

Codebase remains team-ready: strict TS, clean ESLint, Prettier-enforced.

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
```

The same two `NEXT_PUBLIC_SUPABASE_*` values are set on Vercel for
Production + Preview environments. `.env.local` is gitignored.

---

## Deployment

- **GitHub:** [`mparanzales/fun-london`](https://github.com/mparanzales/fun-london) — branch `main`, in sync with `origin/main`.
- **Vercel (Production):** [`fun-london.vercel.app`](https://fun-london.vercel.app) — running on Supabase. **Still gated by Vercel Deployment Protection** (HTTP 401 to anyone not signed into Vercel SSO). Toggle off in Vercel → Settings → Deployment Protection when ready to share publicly.
- **CI:** `.github/workflows/` gates merges on `pnpm check`.
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

## Data layer (Phase 1 + 2 shipped)

| Source | Lives in | Read via |
|---|---|---|
| Venues (11) | Supabase `public.venues` | `lib/queries.ts → fetchVenues / fetchVenueBySlug / fetchVenueById` |
| Events (5) | Supabase `public.events` | `lib/queries.ts → fetchEvents` |
| Saved set | localStorage `fl.saved.v1` (slugs) | `components/saved-context.tsx → useSaved()` |
| Bookings | localStorage `fl.bookings.v1` | `components/bookings-context.tsx → useBookings()` |
| Auth user | Supabase Auth cookies (HTTPOnly) | `lib/auth.ts → getAuthUser()` |
| Profile display name + preferences | `MOCK_USER` (auth email fallback when signed in) | `lib/mock-data.ts → getCurrentUser()` — **Phase 3 moves to `public.profiles`** |
| Plan Together participants (4) | `MOCK_PARTICIPANTS` (static demo data) | `lib/mock-data.ts → getParticipants()` |

**Slug-based references:** `useSaved` keys by `venue.slug` (e.g.
`"padella"`), not `venue.id` (Supabase uuid). Slugs are stable across
reseeds; uuids are not. Phase 3's sign-in migration resolves slug→uuid
when moving saved/bookings into `public.saved_venues` / `public.bookings`.

**Mock data not removed yet.** `lib/mock-data.ts` still contains
`MOCK_VENUES`, `MOCK_EVENTS`, and the old catalog accessors — they're
no longer imported by anything but kept as a local fallback during
testing. Will be removed in a cleanup PR after Phase 3.

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
- **Sign-in flow:** `/sign-in` page → email input → `signInWithOtp` →
  magic link in user's inbox → click → `/auth/callback?code=…` →
  `exchangeCodeForSession` → cookies set → redirect to `?return=` or
  `/explore`. PKCE flow under @supabase/ssr v0.5.
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

1. **Phase 3 — user-scoped data to Supabase.** `useSaved` and
   `useBookings` become dual-mode: localStorage when anonymous, DB
   when authed. One-time migration on first sign-in: read existing
   localStorage entries (slugs), resolve slug→uuid, INSERT into
   `public.saved_venues` / `public.bookings` for the new user, then
   clear local storage. `/profile` reads `display_name` +
   `preferences` from `public.profiles` instead of `MOCK_USER`.
   `/onboarding` writes preferences to the profile row and flips
   `onboarded`.
2. **Cleanup PR after Phase 3.** Remove `MOCK_VENUES`, `MOCK_EVENTS`,
   and the catalog accessors from `lib/mock-data.ts` (currently
   dead code).
3. **Real venue data** — replace the 11 hand-seeded venues with
   curated London venues + image rights cleared. Maria adds them
   directly via the Supabase Dashboard (or a small admin script).
4. **Custom SMTP for auth emails** — wire Resend (or similar) so the
   ~3-4/hour rate limit on Supabase's built-in email service stops
   being a launch blocker.
5. **Vercel Deployment Protection off** — when the site should be
   publicly browsable, toggle off in Vercel → Settings.
6. **Stripe Connect for partners** — partner-side payments / booking
   commissions. Partner Dashboard prototype lives in `project/Partner
   Dashboard.html` (static HTML, not part of this Next.js app yet).

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
