# Fun London — Deployment Guide

A 10-minute path from this codebase to a live URL.

---

## 0 · What you'll do

1. Create a Supabase project + paste schema and seed SQL
2. Push this folder to a fresh GitHub repo
3. Import the repo on Vercel + set 3 env vars
4. Add the Vercel domain back to Supabase auth allowlist
5. Smoke-test the live site

---

## 1 · Supabase project

1. Go to **https://supabase.com/dashboard**, click **New project**.
2. Name it `fun-london`, pick a region near London (e.g. `eu-west-2`), set a strong DB password, click **Create**.
3. Once provisioned, open **Project Settings → API**. Copy:
   - `Project URL` → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Open **SQL Editor → New query**.
   - Paste the entire contents of `supabase/schema.sql`, click **Run**.
   - Open another new query, paste `supabase/seed.sql`, click **Run**.
5. Open **Authentication → URL Configuration**:
   - Set **Site URL** to your Vercel URL once you have it (e.g. `https://fun-london.vercel.app`). For local dev, you can also add `http://localhost:3000` to **Redirect URLs**.
   - Add this redirect URL: `https://fun-london.vercel.app/auth/callback` (and `http://localhost:3000/auth/callback` for local).
6. Open **Authentication → Providers → Email**. Magic links are on by default — confirm **Enable Email provider** is on, and **Confirm email** is OK to keep on.

---

## 2 · Local sanity check

```bash
cd fun-london-app
pnpm install
cp .env.example .env.local
# edit .env.local with your real Supabase URL + anon key
pnpm dev
```

Open `http://localhost:3000`. The splash screen routes to **`/explore`** after about
1.7 seconds. There is no login wall and no onboarding flow: anonymous visitors get a
bounded preview of the catalogue, and signing in unlocks the rest.

⚠️ `supabase/seed.sql` is a **demo** seed: 11 venues, **no photos**, **zero events**. It
also begins with `delete from public.events; delete from public.venues;`, which cascades
to saved venues and bookings. Never run it against a database that has real data.

---

## 3 · Push to GitHub

```bash
cd fun-london-app
git init
git add .
git commit -m "feat: fun london v1"
gh repo create fun-london --public --source=. --remote=origin --push
# or create a repo on github.com manually then:
# git remote add origin git@github.com:YOUR_USER/fun-london.git
# git push -u origin main
```

---

## 4 · Deploy to Vercel

1. Go to **https://vercel.com/new**, click **Import Git Repository**, pick the repo.
2. **Framework preset**: Next.js (auto-detected).
3. **Root directory**: leave as default if `fun-london-app` is the repo root, otherwise set it to `fun-london-app`.
4. Add **Environment Variables**. These three boot the app:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://YOUR-PROJECT.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJ…`
   - `NEXT_PUBLIC_SITE_URL` = your production origin (production is `https://www.funldn.com`)

   These are needed for full behaviour, and each fails **silently** if missing:

   | Variable | Missing means |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | Account deletion and `/admin/*` break |
   | `FL_ADMIN_EMAILS` | `/admin/*` is fail-closed and inaccessible to everyone |
   | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | No analytics |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Search rate limiting falls back to a per-instance in-memory limiter, which is ineffective on serverless. Watch for trailing newlines when pasting the token |
   | `NEXT_PUBLIC_AFFILIATE_*` (5) | Booking links lose attribution |

5. Click **Deploy**.

### GitHub Actions secrets

Five of the seven workflows fail without their own secrets, set separately in
**Settings → Secrets and variables → Actions**: `SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_PLACES_API_KEY`, `TICKETMASTER_API_KEY`, `EVENTBRITE_PRIVATE_TOKEN`,
`RESEND_API_KEY`, `EMAIL_FROM`, and the R2 set (`R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_BASE`,
`R2_BACKUP_BUCKET`).

### Database backups: the one that silently never ran

`R2_BACKUP_BUCKET` was missing for weeks and nobody noticed, because
`backup-db.yml` fails on a schedule where nothing is watching. There were **no
database backups at all** during that window. The only signal was an
auto-opened `cron-failure` issue.

`scripts/backup-db.ts` refuses to run without it, and also refuses if it equals
`R2_BUCKET`, because the photos bucket is world-readable via `img.funldn.com`
and a backup there would be an enumerable PII leak. Both refusals are correct.
Set it up properly:

1. **Cloudflare dashboard → R2 → Create bucket.** Name it something like
   `fun-london-backups`. Keep the location default.
2. **Leave public access DISABLED.** Do not connect a custom domain. This
   bucket holds user rows: profiles, saved venues, bookings, feedback, plans.
3. The existing `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` already cover it,
   as long as that API token's permission is **Object Read & Write** across
   your account rather than scoped to the photos bucket. If it is scoped,
   widen it or issue a second token.
4. **GitHub → Settings → Secrets and variables → Actions → New secret**:
   `R2_BACKUP_BUCKET` = the bucket name.
5. **Actions → backup-db → Run workflow** to trigger it immediately instead of
   waiting for Sunday.
6. **Confirm an object actually landed in the bucket.** A green tick is not
   proof; open R2 and look. Then close the `cron-failure` issue.

Retention is 12 weeks, pruned by the script. Restore procedure is in
[docs/RESTORE.md](./docs/RESTORE.md).

⚠️ Known limitation, written down so it is not a surprise during an incident:
this exports the `public` schema only. `auth.users` (the login accounts) lives
in the `auth` schema and is not reachable through PostgREST, so **it is not
captured**. Restoring gives you the data but not the accounts. See
`docs/RESTORE.md` for the `pg_dump` route to a genuinely full backup.

⚠️ **The Places API is metered.** Google retired the $200 monthly Maps credit in March
2025. Cap it at Console → Google Maps Platform → Quotas → Places API → requests per day.
A billing **alert** does not stop spend; only a **quota** does.

---

## 5 · After first deploy

1. Copy the Vercel URL (e.g. `https://fun-london.vercel.app`).
2. Back in **Supabase → Authentication → URL Configuration**:
   - Set **Site URL** = `https://fun-london.vercel.app`
   - Add to **Redirect URLs**: `https://fun-london.vercel.app/auth/callback`
3. In **Vercel → Project → Settings → Environment Variables**, set `NEXT_PUBLIC_SITE_URL` = `https://fun-london.vercel.app` and **redeploy** (Deployments → ⋯ → Redeploy).

---

## 6 · Testing checklist

Open the live URL on **mobile** and on **desktop**:

Signed out first, then signed in. Both states matter.

**Signed out**
- [ ] `/` routes to `/explore`
- [ ] Explore shows a bounded preview per category, then a sign-up wall
- [ ] A venue page renders with a short teaser and tags, and the full description is gated
- [ ] The map on a venue page is blurred or greyed, not fully revealed
- [ ] Cookie consent banner appears; declining keeps analytics off
- [ ] Legal pages load at `/privacy`, `/cookies`, `/terms`

**Signed in**
- [ ] Google OAuth works, and the magic link opens `/explore`
- [ ] Tapping the heart on a place card flips the icon and persists to the DB
- [ ] **What's on** lists events grouped by date label
- [ ] **Saved** shows the places you hearted
- [ ] **Plan**: mood + budget + area → Generate → a 3-stop plan with a walking route map → Save
- [ ] **Plan Together**: open a room on one device, join with the code on a second, and confirm both build the same plan
- [ ] **You** shows email, save count, plan count, preferences
- [ ] Sign out, then sign in as a different user, and confirm the first user's saves are gone

**Both**
- [ ] Bottom nav doesn't overlap content on a phone; desktop shows the wider shell
- [ ] Theme switches to night between 18:00 and 06:00, and the manual toggle persists
- [ ] Reload mid-flow doesn't crash
- [ ] `/admin/candidates` is inaccessible unless your email is in `FL_ADMIN_EMAILS`

⚠️ **Verify on production, not only on a PR preview.** Preview deploys point at a stale
dev Supabase project with missing columns and OAuth disabled, so a preview-only pass
produces false greens.

---

## 7 · Not built yet

Plan Together, venue and event detail pages, calendar export and sharing have all
shipped. What is still absent:

- **Push notifications.**
- **Skiddle and DICE event adapters** — both return an empty array today. Eventbrite and
  Ticketmaster are live.
- **Editorial press discovery** (`scripts/scout-candidates.ts`) — all six publication
  adapters are stubs. The only live discovery is the weekly Google Places sweep.
- **Host migration in Plan Together** — if the host leaves a room, veto majorities stop
  applying.
- **Automated publication** — `pnpm ingest:from-pending` is run by hand after a human
  approves candidates at `/admin/candidates`.
- **A migrations directory** — the schema is one idempotent `supabase/schema.sql` applied
  by hand.

---

## 8 · Troubleshooting

- **Magic link redirects to localhost**: you forgot to update Supabase **Site URL** + **Redirect URLs** to the Vercel domain (step 5).
- **Build fails on Vercel with `next: not found`**: confirm Vercel **Root Directory** is set to `fun-london-app` if your repo has the app inside a subfolder.
- **`Cannot find module '@supabase/ssr'`**: run `pnpm install` locally and recommit `pnpm-lock.yaml`.
- **RLS errors saving a place**: confirm you ran the *whole* `schema.sql` — the `saved self write` policy must exist.
- **Images don't load**: check the host is in `remotePatterns` in `next.config.js`. Allowed today: `img.funldn.com` (Cloudflare R2, primary), `places.googleapis.com`, `lh3.googleusercontent.com`, `*.supabase.co`, `*.ticketm.net`, `images.universe.com`, `img.evbuc.com`. Unsplash is **not** allowed and is filtered out of every feed query, so an Unsplash venue silently never appears. Note `images.unoptimized: true` is deliberate: the Vercel Hobby image optimizer returns 402 over quota, which broke every photo on the site.
- **A venue was added but never shows up**: it is probably missing `google_place_id`, canonical tags or an embedding, or its `img_url` host is not allowed. Add venues through `scripts/venues-seed.ts` + `pnpm ingest`, not the Table Editor.
- **`/admin/*` returns not-found for you**: `FL_ADMIN_EMAILS` is unset or does not contain your address. It is fail-closed by design.
- **Crons are green but nothing is ingested**: the workflow's API secret is missing. Check the Actions secrets list in step 4.
