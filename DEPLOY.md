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

Open `http://localhost:3000` → you should be redirected to `/sign-in`. Submit your email, click the magic link in your inbox, and you should land on `/onboarding` then `/explore` with seeded places.

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
4. Add **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://YOUR-PROJECT.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJ…`
   - `NEXT_PUBLIC_SITE_URL` = `https://fun-london.vercel.app` (use the URL Vercel will give you; you can set this after first deploy and redeploy)
5. Click **Deploy**.

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

- [ ] `/` redirects to `/sign-in`
- [ ] Submitting an email shows the "Check your email" screen
- [ ] Magic link in email opens `/explore` (after onboarding the first time)
- [ ] **Onboarding** runs once on first sign-in; "Skip" works
- [ ] **Explore** shows 3 rails of seeded places with images
- [ ] Tapping the heart on a place card flips the icon (saves to DB)
- [ ] **Events** shows seeded events grouped by date label
- [ ] **Saved** shows the places you hearted
- [ ] **Plan**: pick mood + budget + area → "Generate" → see 3-step plan → "Save plan" works
- [ ] **Profile** shows your email, save count, plan count, preferences
- [ ] **Sign out** returns to `/sign-in`
- [ ] On a phone, the bottom nav doesn't overlap content; layout is comfortable
- [ ] Theme switches to night between 18:00–06:00 (or change device clock to test)
- [ ] Reload during any flow doesn't crash (error boundary catches anything weird)

---

## 7 · What's intentionally not included in v1

- **Plan Together** (group flow) — designed but deferred.
- **Place detail pages** — `PlaceCard` links to `/explore/[slug]` but the page isn't built. Add when you have real photo/description data.
- **Real London data** — replace seeded mocks via the Supabase Table Editor.
- **Push notifications, calendar export, social** — out of scope.

---

## 8 · Troubleshooting

- **Magic link redirects to localhost**: you forgot to update Supabase **Site URL** + **Redirect URLs** to the Vercel domain (step 5).
- **Build fails on Vercel with `next: not found`**: confirm Vercel **Root Directory** is set to `fun-london-app` if your repo has the app inside a subfolder.
- **`Cannot find module '@supabase/ssr'`**: run `pnpm install` locally and recommit `pnpm-lock.yaml`.
- **RLS errors saving a place**: confirm you ran the *whole* `schema.sql` — the `saved self write` policy must exist.
- **Images don't load**: `next.config.js` already allows `images.unsplash.com`. If you swap to another host, add it to `remotePatterns`.
