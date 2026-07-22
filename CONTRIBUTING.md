# Contributing to Fun London

Short, opinionated guide. Read once before your first PR. Source files
that contradict this doc are the bug — fix them, don't propagate them.

---

## Setup

```bash
# Pin Node version (or your tool of choice)
nvm use         # reads .nvmrc → 20.16

# Install
pnpm install    # corepack auto-switches to pnpm 9.0.0 per package.json

# Run dev server
pnpm dev        # http://localhost:3000
```

`.env.local` **is** required. There is no bypass mode: `middleware.ts` calls
`updateSession()` on every request and `lib/supabase/client.ts` asserts the
Supabase URL and anon key are present, so the app will not render without
them. Copy `.env.example` to `.env.local` and fill in at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` (leave it unset and OG/canonical URLs point at prod)

Note the Node split: `.nvmrc` pins 20.16 for local work, but every CI
workflow runs Node 22 (vitest and vite are ESM-only). A green local
`pnpm check` on 20.16 is not a guarantee of a green CI run.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server (hot reload) |
| `pnpm build` | Production build. Not run by CI, so check it locally before a risky merge |
| `pnpm typecheck` | `tsc --noEmit` — strict TypeScript |
| `pnpm lint` | `next lint` — `next/core-web-vitals` (strict) |
| `pnpm format` | Prettier — write canonical formatting to all files |
| `pnpm format:check` | Prettier — verify no diffs |
| `pnpm test` | vitest — unit tests in `lib/__tests__/` and `scripts/__tests__/` |
| `pnpm check:copy` | Copy linter — no em dashes, en dashes or spaced `--` in user-facing text |
| **`pnpm check`** | **typecheck + lint + format:check + check:copy + test — run this before pushing** |
| `pnpm clean` | Remove `.next`, `.turbo`, Node cache (use when dev gets weird) |

If `pnpm check` fails, fix locally before opening a PR. CI will gate on it.

There are ~67 scripts in `package.json` beyond these: ingestion, discovery,
photo migration, embeddings, verification harnesses and ops. **Every mutating
script has a `:dry` twin** (`pnpm ingest:dry`, `pnpm refresh-venues:dry`).
Run the dry version first, always.

---

## Code style — the non-negotiables

### 1. Tailwind-first, no inline styles unless dynamic

✅ **Good:**
```tsx
<div className="bg-card text-fg rounded-2xl p-4">Hi</div>
```

❌ **Bad:**
```tsx
<div style={{ background: "var(--fl-card)", color: "var(--fl-fg)" }}>Hi</div>
```

**Inline styles are only allowed for genuinely dynamic values** — things
Tailwind can't express at all:
- Runtime colors (e.g. `participant.color` HSL strings)
- Image background URLs (`url(${imgUrl}) center/cover`)
- Multi-stop gradients between two CSS variables
- Animation `animation-delay` per loop index

Everything else uses Tailwind class utilities.

### 2. Always use theme tokens, never raw colors

✅ **Good:** `text-fg`, `bg-card`, `border-border`, `text-primary`, `text-accent`
❌ **Bad:** `text-white`, `bg-gray-100`, `color: "#1a1409"`, `text-[#fff]`

The single exception: `text-white` and `bg-white/X` are fine **when
explicitly over an image or gradient** (e.g. card photo overlays, hero
banners). They're never OK on a page-background surface — they'd
disappear in day theme.

Token reference: see `app/globals.css` (the `--fl-*` tokens).

### 3. Server components by default; client only when needed

A page is a server component unless it uses:
- `useState` / `useEffect` / `useRef`
- `useRouter` / `useSearchParams`
- `useSaved` or other context hooks
- `onClick` / `onChange` handlers
- Browser-only APIs

If you need state in a server-rendered page, factor the interactive
piece into a separate client component (`"use client"`).

### 4. All catalogue reads go through `lib/queries.ts`

`lib/queries.ts` is server-only and is the single choke point for venue and
event data. **Never `select(*)` on a path an anonymous visitor can reach** —
it typechecks perfectly and then either 500s in production (`permission
denied`, because the `anon` role has column-level grants) or leaks moat
fields. Anonymous payloads go through `mapVenuePreview`, which blanks every
detail field; the leak-guard test pins that shape.

`lib/mock-data.ts` is vestigial (41 lines, one live import, no venue data).
Do not add to it. The catalogue has been DB-only since Phase 1.

Two more invariants worth knowing before you touch them:

- **The root layout must stay cookie-free.** Adding `cookies()` or
  `getAuthUser()` to `app/layout.tsx` forces every route into dynamic
  rendering and silently disables ISR on the `/anon` twins, with no error.
- **Every catalogue read keeps `.is("hidden_at", null)`.** A branch that
  predates the column resurrects hidden junk venues when merged.

### 5. Routes: mobile-first and desktop-complete; consumer shell under `(main)`

| Path | Purpose |
|---|---|
| `app/page.tsx` | Splash — outside any group, no nav chrome. Always routes to `/explore` |
| `app/(auth)/*` | Sign-in and the OAuth/magic-link callback |
| `app/(main)/*` | Bottom-nav consumer shell (Explore, What's on, Plan, Saved, You) |
| `app/venue/[slug]/*`, `app/event/[id]/*` | Immersive detail — outside `(main)` so the bottom nav is hidden |
| `app/anon/venue/[slug]`, `app/anon/event/[id]` | **ISR twins.** Middleware rewrites cookie-less traffic here. Do not link to them directly |
| `app/(legal)/*` | Privacy, cookies, terms |
| `app/admin/*` | Candidate/prospect review, gated on `FL_ADMIN_EMAILS` (fail-closed) |
| `app/booking/[slug]/confirmed/*` | Booking confirmation — same pattern as detail |

If a page should hide the bottom nav, **put it outside `(main)`**.

The shell is `max-w-md lg:max-w-6xl` with a `DesktopNav` at `lg`, and both
detail pages have a two-column desktop spread. A new screen has to handle
both widths, not just 375.

---

## Adding a new venue

Venues live in Supabase (`public.venues`), not in code. Two paths:

**The real path: `scripts/venues-seed.ts` → `pnpm ingest`.**
1. Append an entry to `VENUE_SEEDS` (49 curated entries today). These are
   editorial overrides layered on top of Google Places data.
2. Run `pnpm ingest:dry` to see what would change, then `pnpm ingest`.
3. Places supplies the facts and the photo; your entry supplies the voice.

**Discovered venues** arrive weekly via `discover-venues` into
`public.pending_candidates` and are published only after a human approves
them at `/admin/candidates`, followed by `pnpm ingest:from-pending`.
Nothing auto-publishes.

⚠️ **Do not hand-insert rows in the Supabase Table Editor.** Several writers
feed `public.venues`, so a manual row without `google_place_id`, canonical
tags or an embedding is either skipped by the feed queries or undone by a
cron. Fix the writers, not the row.

⚠️ **`img_url` must be on an allowed host** in `next.config.js`:
`img.funldn.com` (Cloudflare R2, the primary), `places.googleapis.com`,
`lh3.googleusercontent.com`, `*.supabase.co`, or the event CDNs. Unsplash is
**not** allowed and is actively filtered out of every feed query in
`lib/queries.ts`, so an Unsplash venue silently never appears.

⚠️ **`supabase/seed.sql` is a demo seed, not a content path.** It opens with
`delete from public.events; delete from public.venues;`, which cascades to
saves and bookings. Never run it against a populated database.

---

## Adding a new screen

1. **Pick a route group:**
   - Bottom-nav screen → `app/(main)/your-route/page.tsx`
   - Immersive (no nav) → `app/your-route/page.tsx`
2. **Pick a component type:**
   - Static / data-only → server component (no `"use client"`)
   - Interactive → client component with `"use client"` at the top
3. **Theme-aware first paint:** use `bg-bg`, `text-fg`, etc.
4. **Verify both themes:**
   - Day: `document.documentElement.dataset.theme = "day"`
   - Night: `document.documentElement.dataset.theme = "night"`
   - Browser DevTools console — Cmd+Option+J
5. **Mobile-first widths:** design for 375px (iPhone SE) and 393px
   (iPhone 14 Pro). The app shell pins to `max-w-md` on `(main)` routes.

---

## Branch & PR conventions

```
main              # always deployable
feat/xxx          # new feature work
fix/xxx           # bug fix
chore/xxx         # tooling, docs, refactors with no user impact
```

PR body should answer:
1. **What** changed (1–2 sentences)
2. **Why** (link to issue / brief)
3. **How verified** — `pnpm check` output, manual test list, screenshots
   for visual changes (day theme + night theme if relevant)

---

## What we don't do

- **No CSS files** beyond `app/globals.css`. Tailwind + CSS vars only.
- **No `any`, no `@ts-ignore`, no `!` non-null assertions** unless you
  comment why. `strict: true` is the law.
- **No `<img>` tags** — always `next/image`.
- **No `localStorage` access without try/catch** — Safari private mode
  throws.
- **No global state libraries** (Redux, Zustand). Saved/theme state
  lives in React Context. Re-evaluate if we cross 5 contexts.
