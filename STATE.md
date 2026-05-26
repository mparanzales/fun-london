# Fun London — State Snapshot

**Last updated:** 2026-05-26
**Branch state:** post-audit cleanup. Codebase is team-ready: strict
TypeScript, clean ESLint, Prettier-enforced, all inline styles migrated
to Tailwind, dead code removed, schema aligned with current types.
Now pushed to GitHub and deployed to Vercel (see Deployment).

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

No `.env.local` required — Supabase middleware is in bypass mode.

---

## Deployment

- **GitHub:** [`mparanzales/fun-london`](https://github.com/mparanzales/fun-london) — branch `main`, in sync with `origin/main`.
- **Vercel (Production):** [`fun-london-dsizviszo-mparanzales-projects.vercel.app`](https://fun-london-dsizviszo-mparanzales-projects.vercel.app) — currently returns **HTTP 401** because **Vercel Deployment Protection** is enabled (the site is live, just gated behind Vercel SSO). To open it publicly, disable or scope-down protection in Vercel → Settings → Deployment Protection.
- **CI:** `.github/workflows/` gates merges on `pnpm check` (typecheck + lint + format:check).
- **`.env.local`:** not configured on Vercel yet — fine while Supabase is still bypassed; required when item 1 (Supabase wiring) ships.

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

## Mock data caveats

All UI data is sourced from `lib/mock-data.ts` — the single source of
truth until Supabase comes online.

- **`MOCK_USER.displayName = "Maria"`** — drives `/explore` greeting and
  `/profile` h1. Change the constant to re-target the demo persona.
- **Venue overlap on Explore.** The "For You" filter concatenates every
  venue + every event. Padella, Dishoom, and Bao all qualify as evening
  Restaurants and appear in multiple ordered chip filters. Mirrors the
  prototype's overlap; not a bug.
- **`MOCK_BOOKINGS` is empty.** The `Booking` type and accessor exist
  for forward use; partner side / `/booking/[slug]/confirmed` doesn't
  read from the array yet.
- **4 hardcoded participants** in Plan Together (You / Maya / Tom / Alex)
  in `MOCK_PARTICIPANTS`. Mixing step's "X of N voted" and Result's
  vote attribution are static.

---

## Known config caveats

- **Middleware is in bypass mode.** `middleware.ts` has `matcher: []` so
  it never runs. To re-enable auth, restore the matcher pattern and
  populate `.env.local` (template in `.env.example`).
- **`lib/supabase/*` files exist but are unreachable at runtime** —
  reachable only through the dormant middleware. Typecheck clean, never
  called.
- **No `public/manifest.json`** despite `app/layout.tsx` referencing
  `manifest: "/manifest.json"` — harmless 404 in dev. PWA manifest is a
  forward-looking item.
- **No `favicon.ico`.** App Router serves `app/icon.png` (1024×1024
  square) and `app/apple-icon.png` instead. Modern browsers handle this.
- **`themeColor: "#f0eee9"`** in `app/layout.tsx` is hardcoded to day
  cream. iOS chrome bar won't adapt to night theme. P3 follow-up.

---

## What's pending

In rough priority order:

1. **Supabase backend integration** — replace `lib/mock-data.ts`
   accessors with Supabase queries. Schema lives in `supabase/schema.sql`
   (aligned with current types as of this audit). Existing accessor
   signatures are synchronous; **switching to `Promise`-returning
   accessors will require changes at the call sites** (move data
   fetching into server components and pass as props).
2. **Real venue data** — replace the 11 hand-seeded venues with curated
   London venues + image rights cleared.
3. **Auth re-enable** — restore `middleware.ts` matcher, populate
   `.env.local`, and reinstate a sign-in flow (was at `app/(auth)/sign-in/`
   in v1, removed; not in git history — rebuild from scratch).
4. **Stripe Connect for partners** — partner-side payments / booking
   commissions. Partner Dashboard prototype lives in `project/Partner
   Dashboard.html` (static HTML, not part of this Next.js app yet).
5. **Vercel deployment** — ✅ done. Live at
   `fun-london-dsizviszo-mparanzales-projects.vercel.app`. Leftover:
   toggle off **Deployment Protection** if/when the site should be
   publicly browsable (currently returns 401 to anyone not signed into
   Vercel SSO). Also: add `NEXT_PUBLIC_SUPABASE_*` env vars in Vercel
   project settings when item 1 ships.
6. **A Booking context (`useBookings()`)** mirroring `useSaved()` — so
   the confirmation page can write the booking and `/saved` can surface
   it alongside saved venues.

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
