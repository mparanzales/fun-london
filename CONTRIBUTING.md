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

No `.env.local` is required for current development. Supabase middleware
is in bypass mode.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server (hot reload) |
| `pnpm build` | Production build — must pass before merging |
| `pnpm typecheck` | `tsc --noEmit` — strict TypeScript |
| `pnpm lint` | `next lint` — `next/core-web-vitals` (strict) |
| `pnpm format` | Prettier — write canonical formatting to all files |
| `pnpm format:check` | Prettier — verify no diffs |
| **`pnpm check`** | **typecheck + lint + format:check — run this before pushing** |
| `pnpm clean` | Remove `.next`, `.turbo`, Node cache (use when dev gets weird) |

If `pnpm check` fails, fix locally before opening a PR. CI will gate on it.

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

### 4. Mock data is the single source of truth

All UI reads from `lib/mock-data.ts` accessors (`getVenues`,
`getCurrentUser`, etc.). **Don't inline mock arrays in components.**
When Supabase ships, only `lib/mock-data.ts` needs to change.

### 5. Routes are mobile-first; consumer shell sits under `(main)`

| Path | Purpose |
|---|---|
| `app/page.tsx` | Splash — outside any group, no nav chrome |
| `app/(auth)/onboarding/*` | Auth-adjacent flows |
| `app/(main)/*` | Bottom-nav consumer shell (Explore, Events, Plan, Saved, Profile) |
| `app/venue/[slug]/*` | Immersive venue detail — outside `(main)` so the bottom nav is hidden |
| `app/booking/[slug]/confirmed/*` | Booking confirmation — same pattern |

If a page should hide the bottom nav, **put it outside `(main)`**.

---

## Adding a new venue

Venues live in Supabase (`public.venues`), not in code. Two paths:

**One-off, via Dashboard:**
1. Open the Supabase Dashboard → Table Editor → `venues`.
2. Click **Insert row**, fill every field. All non-nullable columns
   are required — see `supabase/schema.sql` for the full list.
3. `slug` must be URL-safe and unique; `img_url` should point at
   `images.unsplash.com` (configured in `next.config.js`).
4. The app picks it up on the next page load — no deploy needed.

**Batch / version-controlled, via seed:**
1. Edit `supabase/seed.sql` — add a `(...)` row to the `insert into
   public.venues ...` block.
2. Paste the file into the Supabase SQL Editor → Run.
3. Commit the updated `seed.sql` so the seed stays the canonical
   source of truth for the demo dataset.

Avoid putting venues back into `lib/mock-data.ts` — the catalog is
DB-only since Phase 1.

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
