# Fun London — Web App

A mobile-first Next.js app that helps Londoners decide where to go tonight.

## Stack

- **Next.js 14** App Router + TypeScript (strict)
- **Tailwind CSS** with CSS variables for day/night theming
- **Supabase** — Postgres + Auth (magic link, PKCE) + RLS
- **Vercel** — production hosting + preview deploys
- **pnpm** workspace, Node 20.16 (`.nvmrc`)

## Quick start

```bash
nvm use                      # 20.16
pnpm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev                     # → http://localhost:3000
```

Before pushing, run **`pnpm check`** (typecheck + lint + format:check).

## Folder layout

```
fun-london-app/
├─ app/
│  ├─ (auth)/                       # Auth-related routes (no bottom nav)
│  │  ├─ auth/callback/route.ts     # Magic-link exchange
│  │  ├─ onboarding/                # 2-step mood/vibe quiz
│  │  └─ sign-in/                   # Email input + magic-link send
│  ├─ (main)/                       # Bottom-nav consumer shell
│  │  ├─ layout.tsx                 # max-w-md mobile shell + nav
│  │  ├─ events/                    # page.tsx (server) + events-feed.tsx (client)
│  │  ├─ explore/                   # page.tsx + explore-feed.tsx
│  │  ├─ plan/                      # plan-flow + plan-together-card + together/_steps/
│  │  ├─ profile/                   # page.tsx + profile-body.tsx (anon / authed branch)
│  │  └─ saved/                     # page.tsx + saved-list.tsx
│  ├─ booking/[slug]/confirmed/     # Immersive booking confirmation (outside main)
│  ├─ venue/[slug]/                 # Immersive venue detail (outside main)
│  ├─ layout.tsx                    # Root layout — async, fetches auth user, mounts providers
│  ├─ globals.css                   # Tailwind directives + CSS vars (day/night)
│  ├─ icon.png / apple-icon.png     # App icons (PWA)
│  ├─ not-found.tsx                 # Branded 404
│  └─ page.tsx                      # Splash (gradient wordmark → /onboarding | /explore)
├─ components/
│  ├─ bookings-context.tsx          # useBookings — localStorage anon / Supabase authed
│  ├─ saved-context.tsx             # useSaved — same dual-mode pattern
│  ├─ bottom-nav.tsx                # 5-tab bottom bar
│  ├─ event-card.tsx
│  ├─ venue-card.tsx
│  ├─ theme-provider.tsx            # Day/night toggle (auto by clock)
│  ├─ logo.tsx
│  └─ error-boundary.tsx
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts                  # Browser Supabase client
│  │  ├─ server.ts                  # Server Component client (cookies)
│  │  └─ middleware.ts              # Session-refresh middleware logic
│  ├─ auth.ts                       # getAuthUser() server helper
│  ├─ queries.ts                    # Async catalog fetchers (Server Components only)
│  ├─ mock-data.ts                  # User + saved-seed + participants (last bits not in DB)
│  ├─ types.ts                      # Shared TS types
│  ├─ config.ts                     # App constants (CITY)
│  ├─ clsx.ts / utils.ts            # Tiny helpers
├─ middleware.ts                    # Next.js middleware entry
├─ supabase/
│  ├─ schema.sql                    # Tables + RLS + auto-profile trigger
│  └─ seed.sql                      # 11 venues + 5 events
├─ public/                          # app-icon, logo, etc.
├─ .nvmrc / .editorconfig / .prettierrc / .eslintrc.json
├─ next.config.js / tailwind.config.ts / tsconfig.json
├─ package.json                     # pnpm 9.0.0; scripts: dev / build / check / format
├─ DEPLOY.md                        # Deployment walkthrough
├─ CONTRIBUTING.md                  # Conventions (read before first PR)
└─ STATE.md                         # Point-in-time snapshot — read this first
```

## Data flow at a glance

```
Browser (Client Components)              Server (Server Components)            Supabase
─────────────────────────                ──────────────────────────             ────────
useSaved / useBookings                   Page-level Server Components           public.venues
  • anon  → localStorage                   • await fetchVenues / fetchEvents    public.events
  • authed → public.saved_venues /          (via lib/queries.ts)                 public.profiles  (auto-created
                  bookings                  • await getAuthUser()                   on auth.users insert)
                                            (via lib/auth.ts)                    public.saved_venues
Auth via signInWithOtp →                  Pass data + authUserId as props      public.bookings
  /auth/callback exchanges code             to client leaves                   Auth (email magic-link)
  → cookies set                                                                RLS: each user sees only
                                                                                  their own rows
```

## Where to read next

| For | Open |
|---|---|
| Current state of the build | [STATE.md](./STATE.md) |
| Code conventions before your first PR | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Deployment walkthrough | [DEPLOY.md](./DEPLOY.md) |
| Schema + RLS policies | [supabase/schema.sql](./supabase/schema.sql) |
| Seed data | [supabase/seed.sql](./supabase/seed.sql) |
