# Fun London — Web App (v1)

A mobile-first Next.js app that helps Londoners decide where to go tonight.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** for styling, with CSS variables for day/night theming
- **Supabase** — Postgres, magic-link auth, RLS
- **Vercel** for deployment

## Quick start

```bash
pnpm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev
```

Open http://localhost:3000.

## Folder layout

```
fun-london-app/
├─ app/                      # Next.js App Router
│  ├─ (main)/                # Authed shell with bottom nav
│  │  ├─ layout.tsx          # Bottom nav, theme provider
│  │  ├─ explore/page.tsx
│  │  ├─ events/page.tsx
│  │  ├─ saved/page.tsx
│  │  ├─ plan/page.tsx
│  │  └─ profile/page.tsx
│  ├─ (auth)/
│  │  ├─ sign-in/page.tsx
│  │  ├─ onboarding/page.tsx
│  │  └─ auth/callback/route.ts
│  ├─ layout.tsx             # Root layout, fonts, globals.css
│  ├─ globals.css            # Tailwind + CSS vars (day/night)
│  └─ page.tsx               # Marketing/landing → redirects authed users
├─ components/
│  ├─ ui/                    # Button, Card, Pill, Skeleton…
│  ├─ place-card.tsx
│  ├─ event-card.tsx
│  ├─ bottom-nav.tsx
│  └─ ...
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts           # Browser client
│  │  ├─ server.ts           # Server component client
│  │  └─ middleware.ts       # Auth cookie refresh
│  ├─ types.ts               # DB row types
│  └─ plan-engine.ts         # Plan My Night deterministic logic
├─ middleware.ts
├─ supabase/
│  ├─ schema.sql             # Tables + RLS
│  └─ seed.sql               # Mock places + events
├─ next.config.js
├─ tailwind.config.ts
├─ tsconfig.json
├─ package.json
└─ DEPLOY.md
```

See `DEPLOY.md` for the full deployment walkthrough.
